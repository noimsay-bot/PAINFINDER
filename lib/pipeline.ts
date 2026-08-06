import { DEFAULT_LIMITS, HARD_LIMITS, RUN_TIME_BUDGET, hasRunProcessingBudget } from "./limits";
import { classifyMarket, createAppMarketSearchContext, mergeProducts, searchAppMarket, verifyMarket, type MarketVerdict, type ProductCompetitor, type VerificationCounts } from "./competitors";
import { getLlmProvider, LlmProviderError, resolveLlmModel, type LlmResult } from "./llm";
import { calculateLlmCost } from "./llm/pricing";
import { normalizeNaverPostdate, normalizeNaverText, searchNaver, type NaverSearchType } from "./naver";
import { detectPromotionalSignals } from "./promotional";
import { classifyFinalRuleRejection, type RuleExclusion } from "./rule-filter";
import { calculateFourScores, type BuyerContext, type FourScores } from "./scoring";
import { matchWatchedCafe, type WatchedCafe } from "./watched-cafes";
import { DEFAULT_REVIEW_QUEUE_MIN_SCORE, mergeSimilarCandidates, reviewStatusFor } from "./review-queue";
import {
  APP_REVIEW_MAX_PER_APP,
  fetchPlayReviews,
  hasIncumbentDissatisfaction,
  isPlayBlockError,
  isPlayScrapeEnabled,
  playScrapeDelay,
  type ReviewApp,
  type ReviewPlatform,
} from "./app-reviews";

export type SourceWeightKey = NaverSearchType | "appreview" | "threads" | "hn";

export type RunConfig = {
  id?: string;
  name?: string;
  model_stage1?: string;
  model_stage2?: string;
  model_verify?: string;
  mode_ratio?: number;
  families?: Record<string, number>;
  queries?: string[];
  query_origins?: Record<string, string>;
  domains?: string[];
  excluded_domains?: string[];
  sources?: Record<string, boolean>;
  source_weights?: Partial<Record<SourceWeightKey, number>>;
  threads_keyword_search_enabled?: boolean;
  period_days?: number;
  auto_verify_top_n?: number;
  app_list?: Array<{ platform: "ios" | "android"; appId: string; country?: string }>;
  limits?: { queries?: number; itemsPerSource?: number; dailyCostUsd?: number };
};

type NormalizedRunConfig = {
  id?: string;
  name: string;
  model_stage1: string;
  model_stage2: string;
  model_verify: string;
  mode_ratio: number;
  families: Record<string, number>;
  queries: string[];
  query_origins: Record<string, string>;
  excluded_domains: string[];
  sources: Record<string, boolean>;
  source_weights: Record<SourceWeightKey, number>;
  threads_keyword_search_enabled: boolean;
  period_days: number;
  auto_verify_top_n: number;
  app_list: Array<{ platform: "ios" | "android"; appId: string; country?: string }>;
  limits: { queries: number; itemsPerSource: number; dailyCostUsd: number };
};

export type RawSignal = {
  source: string;
  source_id: string;
  url: string;
  title: string;
  body: string;
  posted_at: string | null;
  query_text: string | null;
  query_origin: string | null;
  raw_payload: Record<string, unknown> | null;
  source_name: string | null;
  author_name: string | null;
  body_length: number;
  low_confidence: boolean;
  promotional_signals: string[];
  promotional_signal_score: number;
  promotional_rule_flagged: boolean;
  is_promotional: boolean;
  highlight_terms: string[];
  watched: boolean;
  watched_cafe_id: string | null;
  app_target_id: number | string | null;
  app_name: string | null;
  review_platform: ReviewPlatform | null;
  review_score: number | null;
  app_version: string | null;
  incumbent_dissatisfaction: boolean;
};

export type RejectReason = "구직" | "구매문의" | "가격불만" | "신체" | "일회성" | "정보질문" | "학습" | "promotional" | "홍보" | "해결됨" | "기타";
type Stage1 = { id: string; pass: boolean; is_promotional: boolean; borderline?: boolean; type?: string; reason?: string; reject_reason?: RejectReason };
type Analysis = {
  pain_summary: string;
  who: string;
  current_workaround: string | null;
  frequency: "daily" | "weekly" | "monthly" | "occasional";
  money_signal: string | null;
  search_terms_for_verification: string[];
  domain: string;
  ai_replacement_score: number;
  buyer_context: BuyerContext;
  maintenance_score: number;
};

export type RunPipelineOptions = {
  deadlineAt?: number;
  llm1MaxCalls?: number;
  llm2MaxCalls?: number;
};

type RunGuard = () => boolean;

const SOURCE_MAP: Record<string, NaverSearchType> = {
  naverCafe: "cafearticle", naverKin: "kin", naverBlog: "blog", naverWeb: "webkr",
  "네이버카페": "cafearticle", "지식iN": "kin", "블로그": "blog", "웹문서": "webkr",
};

export const DEFAULT_SOURCE_WEIGHTS: Record<SourceWeightKey, number> = {
  appreview: 85,
  blog: 0,
  kin: 0,
  cafearticle: 0,
  threads: 0,
  webkr: 0,
  hn: 15,
};

export const THREADS_KEYWORD_SOURCE_WEIGHTS: Record<SourceWeightKey, number> = {
  ...DEFAULT_SOURCE_WEIGHTS,
  appreview: 45,
  threads: 45,
  hn: 10,
};

export function isNaverCollectionEnabled(value = process.env.ENABLE_NAVER_SOURCES) {
  return String(value ?? "false").trim().toLocaleLowerCase("en-US") === "true";
}

export function allocateSourceTargets<T extends string>(
  total: number,
  enabledSources: T[],
  weights: Partial<Record<T, number>> = DEFAULT_SOURCE_WEIGHTS as Partial<Record<T, number>>,
) {
  const sources = [...new Set(enabledSources)];
  const defaults = DEFAULT_SOURCE_WEIGHTS as Record<string, number>;
  const positive = sources.map(source => ({ source, weight: Math.max(0, Number(weights[source] ?? defaults[source] ?? 0)) }));
  const weightTotal = positive.reduce((sum, item) => sum + item.weight, 0);
  const effective = weightTotal > 0 ? positive : positive.map(item => ({ ...item, weight: 1 }));
  const effectiveTotal = effective.reduce((sum, item) => sum + item.weight, 0);
  const allocations = effective.map(item => {
    const exact = total * item.weight / effectiveTotal;
    return { ...item, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = Math.max(0, total - allocations.reduce((sum, item) => sum + item.count, 0));
  for (const item of [...allocations].sort((a, b) => b.remainder - a.remainder || a.source.localeCompare(b.source))) {
    if (remaining-- <= 0) break;
    item.count++;
  }
  return Object.fromEntries(allocations.map(item => [item.source, item.count])) as Partial<Record<T, number>>;
}

export function effectiveSourceWeights(
  weights: Partial<Record<SourceWeightKey, number>>,
  threadsKeywordSearchEnabled: boolean,
) {
  return {
    ...(threadsKeywordSearchEnabled ? THREADS_KEYWORD_SOURCE_WEIGHTS : DEFAULT_SOURCE_WEIGHTS),
    ...weights,
    ...(!threadsKeywordSearchEnabled ? { threads: 0 } : {}),
  };
}

function enrichRawSignal(
  input: Omit<RawSignal, "body_length" | "low_confidence" | "promotional_signals" | "promotional_signal_score" | "promotional_rule_flagged" | "is_promotional" | "watched" | "watched_cafe_id" | "app_target_id" | "app_name" | "review_platform" | "review_score" | "app_version" | "incumbent_dissatisfaction">
    & Partial<Pick<RawSignal, "watched" | "watched_cafe_id" | "app_target_id" | "app_name" | "review_platform" | "review_score" | "app_version" | "incumbent_dissatisfaction">>,
): RawSignal {
  const promotional = detectPromotionalSignals(input);
  return {
    ...input,
    body_length: input.body.length,
    low_confidence: ["appstore", "playstore"].includes(input.source) ? input.body.length < 15 : input.body.length < 40,
    promotional_signals: promotional.signals,
    promotional_signal_score: promotional.score,
    promotional_rule_flagged: promotional.flagged,
    is_promotional: false,
    watched: input.watched ?? false,
    watched_cafe_id: input.watched_cafe_id ?? null,
    app_target_id: input.app_target_id ?? null,
    app_name: input.app_name ?? null,
    review_platform: input.review_platform ?? null,
    review_score: input.review_score ?? null,
    app_version: input.app_version ?? null,
    incumbent_dissatisfaction: input.incumbent_dissatisfaction ?? hasIncumbentDissatisfaction(input.body),
  };
}

export function normalizeConfig(input: RunConfig): NormalizedRunConfig {
  const threadsKeywordSearchEnabled = Boolean(input.threads_keyword_search_enabled || input.sources?.threadsKeywordSearch);
  const queries = Math.min(Math.max(input.limits?.queries ?? DEFAULT_LIMITS.QUERIES_PER_RUN, 1), HARD_LIMITS.QUERIES_PER_RUN);
  const itemsPerSource = Math.min(Math.max(input.limits?.itemsPerSource ?? DEFAULT_LIMITS.ITEMS_PER_SOURCE.naver, 1), HARD_LIMITS.ITEMS_PER_SOURCE);
  const dailyCostUsd = Math.min(Math.max(input.limits?.dailyCostUsd ?? DEFAULT_LIMITS.DAILY_COST_CEILING_USD, .1), HARD_LIMITS.DAILY_COST_CEILING_USD);
  return {
    id: input.id,
    name: input.name ?? "직접 검색",
    model_stage1: input.model_stage1 ?? "claude-haiku-4-5-20251001",
    model_stage2: input.model_stage2 ?? "claude-sonnet-5",
    model_verify: input.model_verify ?? "claude-sonnet-5",
    mode_ratio: Math.min(Math.max(input.mode_ratio ?? 70, 0), 100),
    families: input.families ?? { workaround: 30, question: 30, seeking: 20, giveup: 10, request: 10 },
    queries: [...new Set((input.queries ?? input.domains ?? []).map(query => query.trim()).filter(Boolean))],
    query_origins: input.query_origins ?? {},
    excluded_domains: input.excluded_domains ?? ["연예", "정치", "스포츠"],
    sources: input.sources ?? { appreview: true, threads: true, hn: true },
    source_weights: {
      ...(threadsKeywordSearchEnabled ? THREADS_KEYWORD_SOURCE_WEIGHTS : DEFAULT_SOURCE_WEIGHTS),
      ...(input.source_weights ?? {}),
    },
    threads_keyword_search_enabled: threadsKeywordSearchEnabled,
    period_days: Math.min(Math.max(input.period_days ?? 7, 1), 365),
    auto_verify_top_n: Math.min(Math.max(input.auto_verify_top_n ?? 10, 0), DEFAULT_LIMITS.LLM2_MAX_CALLS_PER_RUN),
    app_list: input.app_list ?? [],
    limits: { queries, itemsPerSource, dailyCostUsd },
  };
}

function makeQueries(config: ReturnType<typeof normalizeConfig>) {
  return config.queries.slice(0, config.limits.queries);
}

function isJunk(item: RawSignal, excluded: string[]) {
  const text = `${item.title} ${item.body}`.trim();
  if (text.length < 10) return true;
  if (excluded.some(word => text.includes(word))) return true;
  return false;
}

async function collectNaver(
  config: ReturnType<typeof normalizeConfig>,
  queries: string[],
  errors: string[],
  canContinue: RunGuard,
  watchedCafes: WatchedCafe[],
  targets: Partial<Record<SourceWeightKey, number>>,
) {
  if (!isNaverCollectionEnabled()) return [] as RawSignal[];
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [] as RawSignal[];
  const enabled = [...new Set(Object.entries(config.sources).filter(([key, enabled]) => enabled && SOURCE_MAP[key]).map(([key]) => SOURCE_MAP[key]))];
  const collected: RawSignal[] = [];
  for (const type of enabled) {
    if (!canContinue()) break;
    const target = targets[type] ?? 0;
    for (const query of queries) {
      if (!canContinue()) break;
      const sourceCount = collected.filter(i => i.source === type).length;
      const remaining = target - sourceCount;
      if (remaining <= 0) break;
      try {
        const fairShare = Math.max(1, Math.ceil(target / queries.length));
        const items = await searchNaver({ type, query, display: Math.min(100, fairShare, remaining), sort: "date", clientId, clientSecret });
        for (const item of items.slice(0, remaining)) {
          const url = String(item.link ?? "");
          if (!url) continue;
          const watchedCafe = type === "cafearticle" ? matchWatchedCafe(url, watchedCafes) : null;
          collected.push(enrichRawSignal({
            source: type,
            source_id: url,
            url,
            title: String(item.title ?? ""),
            body: String(item.description ?? ""),
            posted_at: normalizeNaverPostdate(item.postdate),
            query_text: query,
            query_origin: config.query_origins[query] ?? "manual",
            raw_payload: (item.raw_payload as Record<string, unknown> | undefined) ?? null,
            source_name: item.cafename ? String(item.cafename) : item.bloggername ? String(item.bloggername) : null,
            author_name: item.bloggername ? String(item.bloggername) : null,
            highlight_terms: Array.isArray(item.highlight_terms) ? item.highlight_terms.map(String).filter(Boolean) : [],
            watched: Boolean(watchedCafe),
            watched_cafe_id: watchedCafe?.cafe_id ?? null,
          }));
        }
      } catch (error) { errors.push(`naver:${type}:${error instanceof Error ? error.message : "unknown"}`); }
    }
  }
  return collected;
}

async function collectHn(config: ReturnType<typeof normalizeConfig>, queries: string[], errors: string[], canContinue: RunGuard, target: number) {
  if (!config.sources.hn && !config.sources.HN) return [] as RawSignal[];
  if (target <= 0) return [] as RawSignal[];
  const result: RawSignal[] = [];
  for (const query of queries.slice(0, 5)) {
    if (!canContinue()) break;
    try {
      const response = await fetch(`https://hn.algolia.com/api/v1/search?tags=story&query=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json() as { hits?: Array<Record<string, unknown>> };
      for (const hit of data.hits ?? []) {
        if (result.length >= target) break;
        const id = String(hit.objectID ?? "");
        result.push(enrichRawSignal({ source: "hn", source_id: id, url: String(hit.url ?? `https://news.ycombinator.com/item?id=${id}`), title: normalizeNaverText(String(hit.title ?? "")), body: normalizeNaverText(String(hit.story_text ?? hit.title ?? "")), posted_at: String(hit.created_at ?? "") || null, query_text: query, query_origin: config.query_origins[query] ?? "manual", raw_payload: hit, source_name: "Hacker News", author_name: hit.author ? String(hit.author) : null, highlight_terms: [] }));
      }
    } catch (error) { errors.push(`hn:${error instanceof Error ? error.message : "unknown"}`); }
  }
  return result.slice(0, target);
}

export function isThreadsApprovalPending(status: number, payload: unknown) {
  return [400, 403].includes(status) && Boolean(payload);
}

async function collectThreads(config: ReturnType<typeof normalizeConfig>, queries: string[], errors: string[], canContinue: RunGuard, target: number) {
  if (!config.sources.threads && !config.sources.Threads) return [] as RawSignal[];
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!token) { errors.push("threads:access-token-missing"); return []; }
  const result: RawSignal[] = [];
  if (!config.threads_keyword_search_enabled) {
    try {
      const userId = process.env.THREADS_USER_ID || "me";
      const url = new URL(`https://graph.threads.net/v1.0/${encodeURIComponent(userId)}/threads`);
      url.searchParams.set("fields", "id,text,permalink,timestamp,username");
      url.searchParams.set("limit", "3");
      url.searchParams.set("access_token", token);
      const response = await fetch(url);
      const data = await response.json() as { data?: Array<Record<string, unknown>>; error?: unknown };
      if (!response.ok) throw new Error(`Threads basic ${response.status}: ${JSON.stringify(data.error ?? data)}`);
      for (const item of data.data ?? []) {
        result.push(enrichRawSignal({ source: "threads", source_id: String(item.id), url: String(item.permalink), title: `@${String(item.username ?? "threads")}`, body: String(item.text ?? ""), posted_at: String(item.timestamp ?? "") || null, query_text: null, query_origin: "threads_basic", raw_payload: item, source_name: "Threads", author_name: item.username ? String(item.username) : null, highlight_terms: [] }));
      }
    } catch (error) { errors.push(`threads:basic:${error instanceof Error ? error.message : "unknown"}`); }
    return result;
  }
  if (target <= 0) return result;
  for (const query of queries.slice(0, 20)) {
    if (!canContinue()) break;
    try {
      const url = new URL("https://graph.threads.net/v1.0/keyword_search");
      url.searchParams.set("q", query); url.searchParams.set("search_type", "RECENT");
      url.searchParams.set("fields", "id,text,permalink,timestamp,username,has_replies"); url.searchParams.set("access_token", token);
      const response = await fetch(url); const data = await response.json() as { data?: Array<Record<string, unknown>>; error?: unknown };
      if (!response.ok) {
        if (isThreadsApprovalPending(response.status, data.error ?? data)) {
          errors.push("threads:approval-pending:keyword-search");
          break;
        }
        throw new Error(`Threads ${response.status}: ${JSON.stringify(data.error ?? data)}`);
      }
      for (const item of data.data ?? []) {
        if (result.length >= target) break;
        result.push(enrichRawSignal({ source: "threads", source_id: String(item.id), url: String(item.permalink), title: `@${String(item.username ?? "threads")}`, body: String(item.text ?? ""), posted_at: String(item.timestamp ?? "") || null, query_text: query, query_origin: config.query_origins[query] ?? "manual", raw_payload: item, source_name: "Threads", author_name: item.username ? String(item.username) : null, highlight_terms: [] }));
      }
    } catch (error) { errors.push(`threads:${error instanceof Error ? error.message : "unknown"}`); }
  }
  return result.slice(0, target);
}

export function reviewCompetitor(raw: RawSignal): ProductCompetitor | null {
  if (!["appstore", "playstore"].includes(raw.source) || !raw.app_name) return null;
  return {
    name: raw.app_name,
    url: raw.url,
    pricing: "unknown",
    quality_note: `${raw.review_platform === "android" ? "Google Play" : "App Store"} 저평점 리뷰에서 자동 확인`,
    last_updated_signal: raw.posted_at,
    seller_name: null,
    source: raw.source === "playstore" ? "playstore" : "appstore",
  };
}

async function collectAppReviews(config: ReturnType<typeof normalizeConfig>, apps: ReviewApp[], errors: string[], canContinue: RunGuard, target: number) {
  if (!config.sources.appstore && !config.sources.appreview && !config.sources["앱리뷰"]) return [] as RawSignal[];
  const result: RawSignal[] = [];
  const active = apps.filter(app => app.active);
  const platformCount = active.reduce((count, app) => count + Number(Boolean(app.ios_app_id)) + Number(Boolean(app.android_package) && isPlayScrapeEnabled()), 0);
  const perPlatformTarget = Math.min(APP_REVIEW_MAX_PER_APP, Math.max(1, Math.ceil(target / Math.max(1, platformCount))));
  for (const app of active.filter(item => item.ios_app_id)) {
    if (!canContinue()) break;
    if (result.length >= target) break;
    try {
      const response = await fetch(`https://itunes.apple.com/kr/rss/customerreviews/id=${encodeURIComponent(String(app.ios_app_id))}/sortBy=mostRecent/json`, { signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error(`iTunes ${response.status}`);
      const data = await response.json() as { feed?: { entry?: Array<Record<string, unknown>> } };
      for (const entry of data.feed?.entry ?? []) {
        const rating = Number((entry["im:rating"] as { label?: string } | undefined)?.label ?? 5);
        if (rating > 3) continue;
        const reviewText = String((entry.content as { label?: string } | undefined)?.label ?? "");
        const reviewAt = String((entry.updated as { label?: string } | undefined)?.label ?? "") || null;
        const version = String((entry["im:version"] as { label?: string } | undefined)?.label ?? "") || null;
        const reviewId = String((entry.id as { label?: string } | undefined)?.label ?? crypto.randomUUID());
        result.push(enrichRawSignal({ source: "appstore", source_id: reviewId, url: app.ios_url || `https://apps.apple.com/kr/app/id${app.ios_app_id}`, title: String((entry.title as { label?: string } | undefined)?.label ?? "저평점 리뷰"), body: reviewText, posted_at: reviewAt, query_text: null, query_origin: "review_app", raw_payload: { score: rating, text: reviewText, at: reviewAt, version, entry }, source_name: app.name, author_name: null, highlight_terms: [], app_target_id: app.id, app_name: app.name, review_platform: "ios", review_score: rating, app_version: version }));
        if (result.filter(item => item.app_target_id === app.id && item.review_platform === "ios").length >= perPlatformTarget || result.length >= target) break;
      }
    } catch (error) { errors.push(`appstore:${app.ios_app_id}:${error instanceof Error ? error.message : "unknown"}`); }
  }

  if (!isPlayScrapeEnabled()) {
    errors.push("playstore:disabled:ENABLE_PLAY_SCRAPE=false");
    return result.slice(0, target);
  }

  let emptyResponses = 0;
  for (const app of active.filter(item => item.android_package)) {
    if (!canContinue() || result.length >= target) break;
    try {
      const remaining = Math.min(perPlatformTarget, target - result.length, APP_REVIEW_MAX_PER_APP);
      const reviews = await fetchPlayReviews(String(app.android_package), remaining);
      if (!reviews.data.length) {
        emptyResponses++;
        errors.push(`playstore:${app.android_package}:empty-response`);
        if (emptyResponses >= 2) {
          errors.push("playstore:source-stopped:repeated-empty-response");
          break;
        }
      } else {
        emptyResponses = 0;
      }
      for (const review of reviews.data) {
        if (review.score > 3) continue;
        const reviewAt = review.date ? new Date(review.date).toISOString() : null;
        result.push(enrichRawSignal({ source: "playstore", source_id: review.id, url: app.android_url || review.url || `https://play.google.com/store/apps/details?id=${encodeURIComponent(String(app.android_package))}`, title: review.title || "저평점 리뷰", body: review.text, posted_at: reviewAt, query_text: null, query_origin: "review_app", raw_payload: { score: review.score, text: review.text, at: reviewAt, version: review.version, review }, source_name: app.name, author_name: review.userName || null, highlight_terms: [], app_target_id: app.id, app_name: app.name, review_platform: "android", review_score: review.score, app_version: review.version || null }));
        if (result.length >= target) break;
      }
    } catch (error) {
      errors.push(`playstore:${app.android_package}:${error instanceof Error ? error.message : "unknown"}`);
      if (isPlayBlockError(error)) {
        errors.push("playstore:source-stopped:block-detected");
        break;
      }
    }
    if (canContinue() && result.length < target) await playScrapeDelay(Number(process.env.PLAY_SCRAPE_DELAY_MS) || undefined);
  }
  return result.slice(0, target);
}

function fallbackAnalysis(item: RawSignal): Analysis {
  return { pain_summary: item.title || item.body.slice(0, 90), who: "확인 필요", current_workaround: null, frequency: "occasional", money_signal: null, search_terms_for_verification: [], domain: "미분류", ai_replacement_score: 0, buyer_context: "hobby_or_oneoff", maintenance_score: 1 };
}

function normalizeAnalysis(value: Partial<Analysis>, item: RawSignal): Analysis {
  const fallback = fallbackAnalysis(item);
  const frequencies = new Set<Analysis["frequency"]>(["daily", "weekly", "monthly", "occasional"]);
  const frequency = frequencies.has(value.frequency as Analysis["frequency"])
    ? value.frequency as Analysis["frequency"]
    : "occasional";
  const searchTerms = Array.isArray(value.search_terms_for_verification)
    ? value.search_terms_for_verification.map(String).map(term => term.trim()).filter(Boolean).slice(0, 3)
    : fallback.search_terms_for_verification;
  const buyerContexts = new Set<BuyerContext>(["business", "individual_repeated", "hobby_or_oneoff"]);
  const clamp = (input: unknown, max: number) => Math.min(max, Math.max(0, Math.round(Number(input) || 0)));
  return {
    pain_summary: String(value.pain_summary ?? fallback.pain_summary),
    who: String(value.who ?? fallback.who),
    current_workaround: value.current_workaround ? String(value.current_workaround) : null,
    frequency,
    money_signal: value.money_signal ? String(value.money_signal) : null,
    search_terms_for_verification: searchTerms,
    domain: String(value.domain ?? fallback.domain),
    ai_replacement_score: clamp(value.ai_replacement_score, 2),
    buyer_context: buyerContexts.has(value.buyer_context as BuyerContext) ? value.buyer_context as BuyerContext : fallback.buyer_context,
    maintenance_score: clamp(value.maintenance_score, 2),
  };
}

type Stage1ModelResult = {
  id?: unknown;
  pass?: unknown;
  is_promotional?: unknown;
  type?: unknown;
  reason?: unknown;
  reject_reason?: unknown;
  borderline?: unknown;
};

export function normalizeStage1Result(result: Stage1ModelResult | undefined, id: string): Stage1 {
  const isPromotional = result?.is_promotional === true;
  const pass = result?.pass === true && !isPromotional;
  const allowed = new Set<RejectReason>(["구직", "구매문의", "가격불만", "신체", "일회성", "정보질문", "학습", "promotional", "홍보", "해결됨", "기타"]);
  return {
    id,
    pass,
    is_promotional: isPromotional,
    ...(result?.borderline === true ? { borderline: true } : {}),
    type: pass ? String(result?.type ?? "기타") : undefined,
    reason: pass ? String(result?.reason ?? "반복 프로세스 문제") : undefined,
    reject_reason: pass
      ? undefined
      : isPromotional
        ? "promotional"
        : allowed.has(result?.reject_reason as RejectReason) ? result?.reject_reason as RejectReason : "기타",
  };
}

export function normalizeWatchedStage1Result(raw: Pick<RawSignal, "watched" | "low_confidence">, result: Stage1): Stage1 {
  if (!raw.watched || result.pass || result.is_promotional) return result;
  const hardRejects = new Set<RejectReason>(["구직", "구매문의", "promotional", "홍보"]);
  if (hardRejects.has(result.reject_reason ?? "기타")) return result;
  if (!raw.low_confidence && !result.borderline) return result;
  return {
    ...result,
    pass: true,
    is_promotional: false,
    type: "원문 확인",
    reason: raw.low_confidence ? "짧은 스니펫 · 가입한 카페 원문 확인 필요" : "경계선 후보 · 가입한 카페 원문 확인 필요",
    reject_reason: undefined,
  };
}

export function buildStage1Prompt(
  batch: Array<Pick<RawSignal, "source" | "title" | "body" | "promotional_signals" | "promotional_signal_score"> & Partial<Pick<RawSignal, "watched" | "low_confidence">>>,
  offset = 0,
) {
  const inputs = batch.map((item, index) => ({
    id: String(offset + index),
    source: item.source,
    title: item.title,
    body: item.body,
    rule_promotional_signals: item.promotional_signals,
    rule_promotional_score: item.promotional_signal_score,
    watched_cafe: Boolean(item.watched),
    snippet_too_short: Boolean(item.low_confidence),
    promotional_threshold_note: item.source === "blog"
      ? "블로그는 협찬·체험단 비율이 높으므로 약한 광고 단서도 엄격히 판정"
      : "룰 신호 하나만으로 광고 확정 금지; 문맥과 시제를 함께 판정",
  }));
  return `다음 게시물을 엄격히 판정하라. 통과하려면 (1) 일회성이 아닌 반복 업무·생활 불편, (2) 글쓴이 본인 또는 소속 조직이 직접 겪는 문제, (3) 사람·가격·운·시장 상황이 아니라 프로세스나 도구의 문제를 모두 만족해야 한다. 하나라도 불명확하면 탈락시켜라.

광고 판별은 특히 시제를 본다. 다음은 페인포인트가 아니라 광고·홍보이므로 제외한다:
- 불편을 과거형으로 서술하고 현재는 해결된 상태인 글("예전엔 불편했는데 지금은 좋다")
- 특정 제품·서비스를 긍정적으로 언급하며 사용을 권유하는 글
- 후기·추천 형식으로 특정 도구의 장점을 나열하는 글
진짜 페인포인트는 현재진행형이다: 지금 불편하거나, 방법을 묻거나, 아직 수기로 하며 해결책을 찾는 상태다.
핵심 판별: "문제 → 해결"로 끝나면 광고, "문제 → 물음표"로 끝나면 페인포인트다.
rule_promotional_signals는 사전 룰이 찾은 참고 신호일 뿐 단독으로 탈락시키지 말고 전체 문맥을 판정하라. 단, blog 소스는 협찬 가능성이 높으므로 더 낮은 광고 임계값을 적용하라.

watched_cafe=true인 글은 사용자가 가입한 카페의 원문을 직접 읽고 최종 판단한다. 명백한 광고·구직·단순구매는 똑같이 제외하되, 페인포인트일 가능성이 경계선이거나 짧은 스니펫 때문에 애매하면 pass=true로 사람에게 넘겨라. 애매한 결과에는 borderline=true를 넣는다. 다른 글은 borderline=false다.

appstore 또는 playstore 소스는 앱의 1~3점 리뷰 전문이다. "특정 기능이 없거나 불편해서 생긴 반복적 불만"만 통과시켜라. "○○ 기능이 있으면 좋겠다", "△△가 안 돼서 다른 앱을 찾는다"는 강한 신호다. 단순 별점 불만("별로예요", "느려요")과 일회성 버그·고장 신고는 탈락시켜라. 다른 앱을 찾거나 갈아타려는 표현은 인컴번트 불만족 신호다.

그 밖의 즉시 제외 범주: 구직·채용·이직·자기소개서·이력서·면접·일자리 배정, 단순 구매/배송/재고/소량·N개 단위 문의, 가격·수수료 불만, 신체·건강 문제, 일회성 환경 불만·고장·사고·분쟁·환불, 단순 정보 질문, 학습·강의·자격증, 판매·모집, 이미 답변으로 해결된 질문.
각 결과에 is_promotional boolean을 반드시 넣는다. is_promotional=true이면 반드시 pass=false, reject_reason="promotional"로 쓴다.
통과는 {"id":"...","pass":true,"is_promotional":false,"borderline":false,"type":"1~6","reason":"한 줄"}, 탈락은 {"id":"...","pass":false,"is_promotional":false,"borderline":false,"reject_reason":"구직|구매문의|가격불만|신체|일회성|정보질문|학습|promotional|홍보|해결됨|기타"}로 작성하라. 반드시 {"results":[...]} JSON 객체로 응답하라.
${JSON.stringify(inputs)}`;
}

export function excludePreviouslyRejectedByUser<T extends { source: string; source_id: string }>(
  items: T[],
  rejectedRows: Array<{ source: string; source_id: string }>,
) {
  const rejectedKeys = new Set(rejectedRows.map(row => `${row.source}\u0000${row.source_id}`));
  const kept = items.filter(item => !rejectedKeys.has(`${item.source}\u0000${item.source_id}`));
  return { kept, excluded: items.length - kept.length };
}

export function excludeByActiveKeywordFilters<T extends { title: string; body: string }>(
  items: T[],
  exclusions: RuleExclusion[],
) {
  const keywords = exclusions.filter(item => item.kind === "keyword").map(item => item.value.trim().toLocaleLowerCase("ko-KR")).filter(Boolean);
  const kept = items.filter(item => {
    const text = `${item.title} ${item.body}`.toLocaleLowerCase("ko-KR");
    return !keywords.some(keyword => text.includes(keyword));
  });
  return { kept, excluded: items.length - kept.length };
}

export async function runPipeline(input: RunConfig, options: RunPipelineOptions = {}) {
  const config = normalizeConfig(input);
  const startedAt = new Date().toISOString();
  const deadlineAt = options.deadlineAt ?? Date.now() + RUN_TIME_BUDGET.DEADLINE_MS;
  let timeBudgetReached = false;
  const canContinue = () => {
    const available = hasRunProcessingBudget(deadlineAt);
    if (!available) timeBudgetReached = true;
    return available;
  };
  const llm1MaxCalls = Math.min(options.llm1MaxCalls ?? DEFAULT_LIMITS.LLM1_MAX_CALLS_PER_RUN, DEFAULT_LIMITS.LLM1_MAX_CALLS_PER_RUN);
  const llm2MaxCalls = Math.min(options.llm2MaxCalls ?? DEFAULT_LIMITS.LLM2_MAX_CALLS_PER_RUN, DEFAULT_LIMITS.LLM2_MAX_CALLS_PER_RUN);
  const errors: string[] = [];
  const queries = makeQueries(config);
  const appReviewsEnabled = Boolean(config.sources.appreview || config.sources.appstore || config.sources["앱리뷰"]);
  const threadsBasicEnabled = Boolean((config.sources.threads || config.sources.Threads) && !config.threads_keyword_search_enabled);
  if (!queries.length && !appReviewsEnabled && !threadsBasicEnabled) throw new Error("검색어를 1개 이상 입력해 주세요.");
  const naverCollectionEnabled = isNaverCollectionEnabled();
  const [watchedCafeRows, reviewAppRows] = await Promise.all([
    naverCollectionEnabled
      ? supabaseRest("watched_cafes?active=eq.true&select=id,cafe_id,cafe_name,topic_seeds,active&order=id.asc") as Promise<WatchedCafe[] | null>
      : Promise.resolve([] as WatchedCafe[]),
    supabaseRest("review_apps?active=eq.true&select=id,name,ios_app_id,android_package,ios_url,android_url,active&order=id.asc")
      .catch(error => {
        errors.push(`review-apps:${error instanceof Error ? error.message : "unavailable"}`);
        return null;
      }) as Promise<Array<Omit<ReviewApp, "category">> | null>,
  ]);
  const watchedCafes = (watchedCafeRows ?? []).map(cafe => ({ ...cafe, topic_seeds: Array.isArray(cafe.topic_seeds) ? cafe.topic_seeds.map(String) : [] }));
  const legacyApps: ReviewApp[] = config.app_list.map(app => ({
    id: null,
    name: app.appId,
    category: "미분류",
    ios_app_id: app.platform === "ios" ? app.appId : null,
    android_package: app.platform === "android" ? app.appId : null,
    ios_url: null,
    android_url: null,
    active: true,
  }));
  const reviewApps = reviewAppRows?.length ? reviewAppRows.map(app => ({ ...app, category: "미분류" })) : legacyApps;
  const enabledWeightedSources: SourceWeightKey[] = [];
  if (naverCollectionEnabled && queries.length && (config.sources.naverCafe || config.sources["네이버카페"]) && process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) enabledWeightedSources.push("cafearticle");
  if (naverCollectionEnabled && queries.length && (config.sources.naverKin || config.sources["지식iN"]) && process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) enabledWeightedSources.push("kin");
  if (naverCollectionEnabled && queries.length && (config.sources.naverBlog || config.sources["블로그"]) && process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) enabledWeightedSources.push("blog");
  if (naverCollectionEnabled && queries.length && (config.sources.naverWeb || config.sources["웹문서"]) && process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) enabledWeightedSources.push("webkr");
  if (appReviewsEnabled && reviewApps.length) enabledWeightedSources.push("appreview");
  if (queries.length && config.threads_keyword_search_enabled && (config.sources.threads || config.sources.Threads) && process.env.THREADS_ACCESS_TOKEN) enabledWeightedSources.push("threads");
  if (queries.length && (config.sources.hn || config.sources.HN)) enabledWeightedSources.push("hn");
  const resolvedWeights = effectiveSourceWeights(config.source_weights, config.threads_keyword_search_enabled);
  const sourceTargets = allocateSourceTargets(config.limits.itemsPerSource, enabledWeightedSources, resolvedWeights);
  const collected = canContinue()
    ? await Promise.all([
      collectNaver(config, queries, errors, canContinue, watchedCafes, sourceTargets),
      collectHn(config, queries, errors, canContinue, sourceTargets.hn ?? 0),
      collectThreads(config, queries, errors, canContinue, sourceTargets.threads ?? 0),
      collectAppReviews(config, reviewApps, errors, canContinue, sourceTargets.appreview ?? 0),
    ]).then(parts => parts.flat())
    : [];
  const collectedUnique = [...new Map(collected.map(item => [`${item.source}:${item.source_id}`, item])).values()];
  const [rejectedRows, activeExclusionRows] = await Promise.all([
    supabaseRest("raw_items?status=eq.rejected_by_user&select=source,source_id&limit=10000") as Promise<Array<{ source: string; source_id: string }> | null>,
    supabaseRest("rule_exclusions?active=eq.true&select=kind,value&limit=1000") as Promise<RuleExclusion[] | null>,
  ]);
  const rejectedGuard = excludePreviouslyRejectedByUser(collectedUnique, rejectedRows ?? []);
  const deduped = rejectedGuard.kept;
  const junkFiltered = deduped.filter(item => !isJunk(item, config.excluded_domains));
  const activeFilterGuard = excludeByActiveKeywordFilters(junkFiltered, activeExclusionRows ?? []);
  const filtered = activeFilterGuard.kept;
  const llm = getLlmProvider();
  const stage1Model = resolveLlmModel(config.model_stage1, "stage1");
  const stage2Model = resolveLlmModel(config.model_stage2, "stage2");
  const verifyModel = resolveLlmModel(config.model_verify, "stage2");
  const unknownPricing = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let runningCost = 0;
  let stoppedReason: string | null = timeBudgetReached ? "time_budget" : null;
  const stopIfTimeBudgetReached = () => {
    if (canContinue()) return false;
    stoppedReason ??= "time_budget";
    return true;
  };
  const recordUsage = (result: LlmResult) => {
    inputTokens += result.inputTokens;
    outputTokens += result.outputTokens;
    const cost = calculateLlmCost(result.model, result.inputTokens, result.outputTokens);
    if (cost === null) {
      if (!unknownPricing.has(result.model)) {
        unknownPricing.add(result.model);
        errors.push(`warning:pricing:unknown-model:${result.model}`);
      }
      return;
    }
    runningCost += cost;
    if (runningCost >= config.limits.dailyCostUsd) stoppedReason = "daily_cost_ceiling";
  };
  const noteLlmError = (stage: "llm1" | "llm2" | "verify", error: unknown) => {
    const message = error instanceof Error ? error.message : "failed";
    errors.push(`${stage}:${message}`);
    if (error instanceof LlmProviderError) {
      stoppedReason = error.details.code === "insufficient_quota" ? "llm_insufficient_quota" : `llm_${error.details.status ?? "connection"}`;
      return true;
    }
    return false;
  };
  const rejectReasons = new Set<RejectReason>(["구직", "구매문의", "가격불만", "신체", "일회성", "정보질문", "학습", "promotional", "홍보", "해결됨", "기타"]);
  const stage1: Stage1[] = [];
  let llm1Calls = 0;
  for (let offset = 0; offset < filtered.length && llm1Calls < llm1MaxCalls && !stoppedReason; offset += 20) {
    if (stopIfTimeBudgetReached()) break;
    const batch = filtered.slice(offset, offset + 20);
    try {
      const completion = await llm.complete({
        model: stage1Model,
        jsonMode: true,
        maxOutputTokens: 2200,
        system: "너는 반복적인 프로세스·도구 문제만 통과시키는 엄격한 페인포인트 판정기다. 반드시 유효한 JSON 객체로만 응답하라.",
        user: buildStage1Prompt(batch, offset),
      });
      llm1Calls++;
      recordUsage(completion);
      const parsed = JSON.parse(completion.text) as { results?: Stage1ModelResult[] };
      if (!Array.isArray(parsed.results)) throw new Error("LLM 1차 응답에 results 배열이 없습니다.");
      const resultById = new Map(parsed.results.map(result => [String(result.id), result]));
      for (let i = 0; i < batch.length; i++) {
        const id = String(offset + i);
        const result = resultById.get(id);
        const normalized = normalizeWatchedStage1Result(batch[i], normalizeStage1Result(result, id));
        batch[i].is_promotional = normalized.is_promotional;
        stage1.push(normalized);
      }
    } catch (error) {
      for (let i = 0; i < batch.length; i++) stage1.push({ id: String(offset + i), pass: false, is_promotional: false, reject_reason: "기타" });
      if (noteLlmError("llm1", error)) break;
    }
  }
  const stage1PassCount = stage1.filter(result => result.pass).length;
  const llm1PassRate = stage1.length ? Number((stage1PassCount / stage1.length).toFixed(4)) : 0;
  if (llm1PassRate > 0.25) errors.push(`warning:llm1:pass-rate-high:${(llm1PassRate * 100).toFixed(1)}%`);
  const rejectReasonCounts = Object.fromEntries([...rejectReasons].map(reason => [reason, stage1.filter(result => !result.pass && result.reject_reason === reason).length]));
  const passedIndexes = stage1.filter(result => result.pass).map(result => Number(result.id)).filter(Number.isFinite);
  const passed = passedIndexes.map(index => filtered[index]).filter(Boolean)
    .sort((a, b) => Number(b.incumbent_dissatisfaction) - Number(a.incumbent_dissatisfaction) || Number(["appstore", "playstore"].includes(b.source)) - Number(["appstore", "playstore"].includes(a.source)) || Number(b.watched) - Number(a.watched) || b.body_length - a.body_length)
    .slice(0, llm2MaxCalls);
  const analyses: Array<{ raw: RawSignal; analysis: Analysis; competitors: ProductCompetitor[]; marketVerdict: MarketVerdict; scores: FourScores; precisionVerified: boolean }> = [];
  let llm2Calls = 0;
  let verifyCalls = 0;
  const verificationCounts: VerificationCounts = { urlExcluded: 0, product: 0, content: 0, irrelevant: 0, appProduct: 0 };
  for (const raw of passed) {
    if (stoppedReason) break;
    if (stopIfTimeBudgetReached()) break;
    let analysis = fallbackAnalysis(raw);
    let stopAfterItem = false;
    try {
      const completion = await llm.complete({
        model: stage2Model,
        jsonMode: true,
        maxOutputTokens: 2200,
        system: "너는 게시물의 페인포인트와 4개 사업성 필터를 근거에 맞게 구조화하는 분석기다. 반드시 유효한 JSON 객체로만 응답하라.",
        user: `게시물을 분석해 다음 JSON 객체로 응답하라. domain은 제품 검색에 쓸 핵심명사로 짧게 쓴다. search_terms_for_verification은 페인포인트 문장을 그대로 쓰지 말고 반드시 핵심명사에 "프로그램", "솔루션", "SaaS", "서비스 요금제", "관리 시스템" 중 하나를 붙인 형식에서만 3개를 만든다. ai_replacement_score는 2=개인 데이터 조회·실시간 데이터·인터랙티브 계산 필요, 1=일부 필요, 0=설명·정의·목록만으로 해결. buyer_context는 business=사업자·법인 업무, individual_repeated=개인의 반복 업무, hobby_or_oneoff=개인 취미·일회성. maintenance_score는 2=규칙이 거의 변하지 않음, 1=연 1~2회 변동, 0=법·제도·정책을 상시 추종해야 함이다. {"pain_summary":"누가 무엇 때문에 불편한가","who":"직업/역할","current_workaround":null,"frequency":"daily|weekly|monthly|occasional","money_signal":null,"domain":"핵심명사","search_terms_for_verification":["핵심명사 프로그램","핵심명사 솔루션","핵심명사 관리 시스템"],"ai_replacement_score":0,"buyer_context":"business|individual_repeated|hobby_or_oneoff","maintenance_score":0} 형태로 응답하라.\n${JSON.stringify(raw)}`,
      });
      llm2Calls++;
      recordUsage(completion);
      analysis = normalizeAnalysis(JSON.parse(completion.text) as Partial<Analysis>, raw);
    } catch (error) { stopAfterItem = noteLlmError("llm2", error); }
    const automaticCompetitor = reviewCompetitor(raw);
    const marketVerdict: MarketVerdict = "unverified";
    analyses.push({
      raw,
      analysis,
      competitors: automaticCompetitor ? [automaticCompetitor] : [],
      marketVerdict,
      scores: calculateFourScores({ aiReplacementScore: analysis.ai_replacement_score, maintenanceScore: analysis.maintenance_score, moneySignal: analysis.money_signal, verdict: marketVerdict, buyerContext: analysis.buyer_context, incumbentDissatisfaction: raw.incumbent_dissatisfaction }),
      precisionVerified: false,
    });
    if (stopAfterItem) break;
  }

  let appIndex = 0;
  const appMarketContext = createAppMarketSearchContext();
  const appWorker = async () => {
    while (appIndex < analyses.length) {
      if (stoppedReason || stopIfTimeBudgetReached()) return;
      const candidate = analyses[appIndex++];
      if (["appstore", "playstore"].includes(candidate.raw.source)) continue;
      const appVerification = await searchAppMarket(candidate.analysis.domain, appMarketContext);
      candidate.competitors = appVerification.products;
      // App-market lookup is only a partial input. Until precision verification
      // finishes, the market state and incumbent score must remain unknown.
      candidate.marketVerdict = "unverified";
      candidate.scores = calculateFourScores({ aiReplacementScore: candidate.analysis.ai_replacement_score, maintenanceScore: candidate.analysis.maintenance_score, moneySignal: candidate.analysis.money_signal, verdict: "unverified", buyerContext: candidate.analysis.buyer_context, incumbentDissatisfaction: candidate.raw.incumbent_dissatisfaction });
      verificationCounts.appProduct += appVerification.counts.appProduct;
      errors.push(...appVerification.errors);
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, analyses.length) }, () => appWorker()));

  const autoTargets = [...analyses].sort((a, b) => b.scores.total - a.scores.total).slice(0, config.auto_verify_top_n);
  let verifiedItems = 0;
  let verifyIndex = 0;
  const verifyWorker = async () => {
    while (verifyIndex < autoTargets.length && !stoppedReason) {
      if (stopIfTimeBudgetReached()) return;
      const candidate = autoTargets[verifyIndex++];
      try {
        const verification = await verifyMarket({ searchTerms: candidate.analysis.search_terms_for_verification, llm, model: verifyModel, naverClientId: naverCollectionEnabled ? process.env.NAVER_CLIENT_ID : undefined, naverClientSecret: naverCollectionEnabled ? process.env.NAVER_CLIENT_SECRET : undefined });
        candidate.competitors = mergeProducts(candidate.competitors, verification.products);
        candidate.marketVerdict = classifyMarket(candidate.competitors);
        candidate.scores = calculateFourScores({ aiReplacementScore: candidate.analysis.ai_replacement_score, maintenanceScore: candidate.analysis.maintenance_score, moneySignal: candidate.analysis.money_signal, verdict: candidate.marketVerdict, buyerContext: candidate.analysis.buyer_context, incumbentDissatisfaction: candidate.raw.incumbent_dissatisfaction });
        candidate.precisionVerified = true;
        verifiedItems++;
        for (const key of Object.keys(verificationCounts) as Array<keyof VerificationCounts>) verificationCounts[key] += verification.counts[key];
        errors.push(...verification.errors);
        if (verification.usage) { verifyCalls++; recordUsage(verification.usage); }
      } catch (error) { noteLlmError("verify", error); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, autoTargets.length) }, () => verifyWorker()));

  const stageCounts = {
    collected: collectedUnique.length,
    source_counts: Object.fromEntries([...new Set(collectedUnique.map(item => item.source))].map(source => [source, collectedUnique.filter(item => item.source === source).length])),
    source_pass_counts: Object.fromEntries([...new Set(filtered.map(item => item.source))].map(source => [source, stage1.filter(result => result.pass && filtered[Number(result.id)]?.source === source).length])),
    previouslyUserRejected: rejectedGuard.excluded,
    activeFilterExcluded: activeFilterGuard.excluded,
    rulePassed: filtered.length,
    llm1Evaluated: stage1.length,
    llm1Passed: stage1PassCount,
    llm1_pass_rate: llm1PassRate,
    reject_reason_counts: rejectReasonCounts,
    promotional: rejectReasonCounts.promotional ?? 0,
    watchedCollected: collectedUnique.filter(item => item.watched).length,
    watchedLlm1Passed: stage1.filter(result => result.pass && filtered[Number(result.id)]?.watched).length,
    watchedQueryCount: queries.filter(query => String(config.query_origins[query] ?? "").startsWith("watched_cafe:")).length,
    threadsKeywordSearchEnabled: config.threads_keyword_search_enabled,
    llm2Analyzed: analyses.length,
    appVerified: analyses.length,
    verified: verifiedItems,
    competitorUrlExcluded: verificationCounts.urlExcluded,
    competitorProduct: verificationCounts.product + verificationCounts.appProduct,
    competitorContent: verificationCounts.content,
    competitorIrrelevant: verificationCounts.irrelevant,
    competitorAppProduct: verificationCounts.appProduct,
  };
  const costEstimate = Number(runningCost.toFixed(4));
  const stage1Evaluations = stage1.flatMap(result => {
    const raw = filtered[Number(result.id)];
    return raw ? [{ raw, result }] : [];
  });
  return { mode: "live", config, startedAt, endedAt: new Date().toISOString(), queries, stageCounts, llmCalls: { stage1: llm1Calls, stage2: llm2Calls, verify: verifyCalls, inputTokens, outputTokens }, costEstimate, stoppedReason, errors, candidates: analyses, stage1Evaluations };
}

export async function supabaseRest(path: string, init: RequestInit = {}) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return null;
  const authHeaders: Record<string, string> = { apikey: key };
  // Supabase's new sb_secret_* keys authenticate through `apikey`; only the
  // legacy JWT service-role keys belong in the Authorization header.
  if (key.startsWith("eyJ")) authHeaders.Authorization = `Bearer ${key}`;
  const response = await fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...authHeaders, "User-Agent": "PainfinderServer/1.0", "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function persistRun(result: Awaited<ReturnType<typeof runPipeline>>) {
  const [exclusionRows, reviewSettingRows] = await Promise.all([
    supabaseRest("rule_exclusions?active=eq.true&select=kind,value&limit=1000") as Promise<Array<{ kind: string; value: string }> | null>,
    supabaseRest("review_settings?id=eq.1&select=min_score&limit=1")
      .catch(() => null) as Promise<Array<{ min_score: number }> | null>,
  ]);
  const exclusions = (exclusionRows ?? []).filter((row): row is RuleExclusion => ["keyword", "domain"].includes(row.kind) && Boolean(row.value));
  const reviewMinScore = Number(reviewSettingRows?.[0]?.min_score ?? DEFAULT_REVIEW_QUEUE_MIN_SCORE);
  const finalRejectByKey = new Map<string, string>();
  const rawKey = (source: string, sourceId: string) => `${source}\u0000${sourceId}`;
  const acceptedCandidates = result.candidates.filter(candidate => {
    const reason = classifyFinalRuleRejection({
      title: candidate.raw.title,
      body: candidate.raw.body,
      summary: candidate.analysis.pain_summary,
      domain: candidate.analysis.domain,
    }, exclusions);
    if (reason) finalRejectByKey.set(rawKey(candidate.raw.source, candidate.raw.source_id), reason);
    return !reason;
  });
  const queueEligible = acceptedCandidates
    .filter(candidate => !reviewStatusFor({
      score: candidate.scores.total,
      marketVerdict: candidate.marketVerdict,
      lowConfidence: candidate.raw.low_confidence,
      reviewOverride: false,
    }, reviewMinScore).reason)
    .sort((a, b) => b.scores.total - a.scores.total);
  const stageCounts = {
    ...result.stageCounts,
    finalRuleRejected: finalRejectByKey.size,
    reviewQueueAdded: queueEligible.length,
    paidOpportunityCount: queueEligible.filter(candidate => candidate.marketVerdict === "paid_exists").length,
    digestTop3: queueEligible.slice(0, 3).map(candidate => candidate.analysis.pain_summary),
  };
  const created = await supabaseRest("run_logs", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ config_id: result.config.id ?? null, started_at: result.startedAt, ended_at: result.endedAt, stage_counts: stageCounts, llm_calls: result.llmCalls, cost_estimate: result.costEstimate, stopped_reason: result.stoppedReason, errors: result.errors }) }) as Array<{ id: string }> | null;
  const runId = created?.[0]?.id;
  if (!runId) return { runId: null, savedCandidates: 0, savedCompetitors: 0, finalRuleRejected: finalRejectByKey.size };

  const rawByKey = new Map<string, Record<string, unknown>>();
  for (const { raw, result: decision } of result.stage1Evaluations) {
    rawByKey.set(rawKey(raw.source, raw.source_id), {
      ...raw,
      run_id: runId,
      status: decision.pass ? "llm1_passed" : "rejected",
      reject_reason: decision.pass ? null : decision.reject_reason ?? "기타",
    });
  }
  for (const candidate of result.candidates) {
    const finalRejectReason = finalRejectByKey.get(rawKey(candidate.raw.source, candidate.raw.source_id));
    const review = reviewStatusFor({
      score: candidate.scores.total,
      marketVerdict: candidate.marketVerdict,
      lowConfidence: candidate.raw.low_confidence,
      reviewOverride: false,
    }, reviewMinScore);
    rawByKey.set(rawKey(candidate.raw.source, candidate.raw.source_id), {
      ...candidate.raw,
      run_id: runId,
      status: finalRejectReason ? "rule_rejected" : "analyzed",
      reject_reason: finalRejectReason ?? null,
      review_status: review.status,
      review_status_reason: review.reason,
      review_status_updated_at: new Date().toISOString(),
    });
  }

  const rawRows = [...rawByKey.values()];
  const storedRawRows = rawRows.length
    ? await supabaseRest("raw_items?on_conflict=source,source_id&select=id,source,source_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(rawRows),
    }) as Array<{ id: string; source: string; source_id: string }> | null
    : [];
  const rawIdByKey = new Map((storedRawRows ?? []).map(row => [rawKey(row.source, row.source_id), row.id]));
  const candidateByRawId = new Map<string, (typeof result.candidates)[number]>();
  for (const candidate of acceptedCandidates) {
    const rawId = rawIdByKey.get(rawKey(candidate.raw.source, candidate.raw.source_id));
    if (rawId) candidateByRawId.set(rawId, candidate);
  }

  const candidateRawIds = [...candidateByRawId.keys()];
  const existingPainRows = candidateRawIds.length
    ? await supabaseRest(`pain_points?raw_item_id=in.(${candidateRawIds.join(",")})&select=id,raw_item_id`) as Array<{ id: string; raw_item_id: string }> | null
    : [];
  const existingRawIds = new Set((existingPainRows ?? []).map(row => row.raw_item_id));
  const verifiedAt = new Date().toISOString();
  const painBodies = candidateRawIds
    .filter(rawId => !existingRawIds.has(rawId))
    .map(rawId => {
      const candidate = candidateByRawId.get(rawId)!;
      return {
        raw_item_id: rawId,
        pain_summary: candidate.analysis.pain_summary,
        who: candidate.analysis.who,
        current_workaround: candidate.analysis.current_workaround,
        frequency: candidate.analysis.frequency,
        money_signal: candidate.analysis.money_signal,
        domain: candidate.analysis.domain,
        signal_type: "llm_pass",
        precision_verified_at: candidate.precisionVerified ? verifiedAt : null,
      };
    });
  const painRows = painBodies.length
    ? await supabaseRest("pain_points?on_conflict=raw_item_id&select=id,raw_item_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(painBodies),
    }) as Array<{ id: string; raw_item_id: string }> | null
    : [];

  const painIdByRawId = new Map((painRows ?? []).map(row => [row.raw_item_id, row.id]));
  const similarityGroups = mergeSimilarCandidates([...painIdByRawId.entries()].map(([rawId, painId]) => {
    const candidate = candidateByRawId.get(rawId)!;
    return {
      id: painId,
      summary: candidate.analysis.pain_summary,
      who: candidate.analysis.who,
      domain: candidate.analysis.domain,
      score: candidate.scores.total,
      marketVerdict: candidate.marketVerdict,
      lowConfidence: candidate.raw.low_confidence,
      watched: candidate.raw.watched,
      decision: "unreviewed",
      recurrence: 1,
      bodyLength: candidate.raw.body_length,
    };
  }));
  for (const group of similarityGroups.filter(item => item.duplicateCount > 0)) {
    const painIds = [group.id, ...group.duplicateIds];
    await supabaseRest(`pain_points?id=in.(${painIds.join(",")})`, {
      method: "PATCH",
      body: JSON.stringify({ cluster_id: group.id, recurrence_count: group.recurrence }),
    });
  }
  const scoreRows = [...painIdByRawId.entries()].map(([rawId, painId]) => {
    const candidate = candidateByRawId.get(rawId)!;
    return {
      pain_point_id: painId,
      f1: candidate.scores.f1,
      f2: null,
      f3: null,
      f4: candidate.scores.f4,
      f5: candidate.scores.f5,
      f6: candidate.scores.f6,
      data_access_stable: candidate.raw.source !== "playstore",
      verdict: candidate.marketVerdict,
      verified: candidate.precisionVerified,
    };
  });
  if (scoreRows.length) {
    await supabaseRest("scores?on_conflict=pain_point_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(scoreRows),
    });
  }

  const competitorRows = [...painIdByRawId.entries()].flatMap(([rawId, painId]) => {
    const candidate = candidateByRawId.get(rawId)!;
    return candidate.competitors.map(competitor => ({ ...competitor, pain_point_id: painId }));
  });
  if (competitorRows.length) {
    await supabaseRest("competitors", { method: "POST", body: JSON.stringify(competitorRows) });
  }

  return {
    runId,
    savedCandidates: painRows?.length ?? 0,
    savedCompetitors: competitorRows.length,
    finalRuleRejected: finalRejectByKey.size,
  };
}
