import { DEFAULT_LIMITS, HARD_LIMITS } from "./limits";
import { normalizeNaverText, searchNaver, type NaverSearchType } from "./naver";

export type RunConfig = {
  id?: string;
  name?: string;
  model_stage1?: string;
  model_stage2?: string;
  model_verify?: string;
  mode_ratio?: number;
  families?: Record<string, number>;
  domains?: string[];
  excluded_domains?: string[];
  sources?: Record<string, boolean>;
  period_days?: number;
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
  domains: string[];
  excluded_domains: string[];
  sources: Record<string, boolean>;
  period_days: number;
  app_list: Array<{ platform: "ios" | "android"; appId: string; country?: string }>;
  limits: { queries: number; itemsPerSource: number; dailyCostUsd: number };
};

type RawSignal = {
  source: string;
  source_id: string;
  url: string;
  title: string;
  body: string;
  posted_at: string | null;
};

type Stage1 = { id: string; pass: boolean; type: string; reason: string };
type Analysis = {
  pain_summary: string;
  who: string;
  current_workaround: string | null;
  frequency: "daily" | "weekly" | "monthly" | "occasional";
  money_signal: string | null;
  search_terms_for_verification: string[];
  domain: string;
};

const FAMILY_QUERIES: Record<string, string[]> = {
  workaround: ["엑셀로 정리", "수기로 관리", "일일이 입력", "매번 손으로", "이중 입력"],
  question: ["다들 어떻게 하세요", "어떻게들 관리하세요", "방법 있을까요", "노하우 좀"],
  seeking: ["프로그램 추천", "앱 추천", "툴 추천", "자동화 방법", "대체할 만한"],
  emotion: ["진짜 짜증", "미치겠", "왜 이렇게 불편", "답답하다", "스트레스"],
  giveup: ["포기했", "그냥 안 하기로", "손 놨", "어쩔 수 없이"],
  request: ["만들어주실 분", "개발 의뢰", "견적", "제작 문의"],
};

const SOURCE_MAP: Record<string, NaverSearchType> = {
  naverCafe: "cafearticle", naverKin: "kin", naverBlog: "blog", naverWeb: "webkr",
  "네이버카페": "cafearticle", "지식iN": "kin", "블로그": "blog", "웹문서": "webkr",
};

export function normalizeConfig(input: RunConfig): NormalizedRunConfig {
  const queries = Math.min(Math.max(input.limits?.queries ?? DEFAULT_LIMITS.QUERIES_PER_RUN, 1), HARD_LIMITS.QUERIES_PER_RUN);
  const itemsPerSource = Math.min(Math.max(input.limits?.itemsPerSource ?? DEFAULT_LIMITS.ITEMS_PER_SOURCE.naver, 1), HARD_LIMITS.ITEMS_PER_SOURCE);
  const dailyCostUsd = Math.min(Math.max(input.limits?.dailyCostUsd ?? DEFAULT_LIMITS.DAILY_COST_CEILING_USD, .1), HARD_LIMITS.DAILY_COST_CEILING_USD);
  return {
    id: input.id,
    name: input.name ?? "기본 실행",
    model_stage1: allowModel(input.model_stage1, "claude-haiku-4-5-20251001"),
    model_stage2: allowModel(input.model_stage2, "claude-haiku-4-5-20251001"),
    model_verify: allowModel(input.model_verify, "claude-sonnet-5"),
    mode_ratio: Math.min(Math.max(input.mode_ratio ?? 70, 0), 100),
    families: input.families ?? { workaround: 30, question: 30, seeking: 20, giveup: 10, request: 10 },
    domains: input.domains?.length ? input.domains : ["자영업", "교육", "이커머스"],
    excluded_domains: input.excluded_domains ?? ["연예", "정치", "스포츠"],
    sources: input.sources ?? { naverCafe: true, naverKin: true, naverBlog: true, appstore: true },
    period_days: Math.min(Math.max(input.period_days ?? 7, 1), 365),
    app_list: input.app_list ?? [],
    limits: { queries, itemsPerSource, dailyCostUsd },
  };
}

function allowModel(value: string | undefined, fallback: string) {
  return value === "claude-sonnet-5" || value === "claude-haiku-4-5-20251001" ? value : fallback;
}

function makeQueries(config: ReturnType<typeof normalizeConfig>) {
  const families = Object.entries(config.families).filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]);
  const result: string[] = [];
  for (let round = 0; result.length < config.limits.queries; round++) {
    for (const [family] of families) {
      const phrases = FAMILY_QUERIES[family] ?? [];
      if (!phrases.length) continue;
      const domain = config.domains[result.length % config.domains.length];
      result.push(`${domain} ${phrases[round % phrases.length]}`);
      if (result.length >= config.limits.queries) break;
    }
  }
  return result;
}

function isJunk(item: RawSignal, excluded: string[]) {
  const text = `${item.title} ${item.body}`.trim();
  if (text.length < 30) return true;
  if (excluded.some(word => text.includes(word))) return true;
  if (/(문의\s*(주세요|바랍니다)|상담|무료체험\s*신청|오픈채팅|open\.kakao|\d{2,3}-\d{3,4}-\d{4})/i.test(text)) return true;
  if (/\d{1,3}(,\d{3})*\s*원/.test(text) && /(구매|주문|판매|특가|할인)/.test(text)) return true;
  return false;
}

async function collectNaver(config: ReturnType<typeof normalizeConfig>, queries: string[], errors: string[]) {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [] as RawSignal[];
  const enabled = Object.entries(config.sources).filter(([key, enabled]) => enabled && SOURCE_MAP[key]);
  const collected: RawSignal[] = [];
  for (const [key] of enabled) {
    const type = SOURCE_MAP[key];
    for (const query of queries) {
      if (collected.filter(i => i.source === type).length >= config.limits.itemsPerSource) break;
      try {
        const items = await searchNaver({ type, query, display: Math.min(100, config.limits.itemsPerSource), sort: "date", clientId, clientSecret });
        for (const item of items) {
          const url = String(item.link ?? "");
          if (!url) continue;
          collected.push({ source: type, source_id: url, url, title: String(item.title ?? ""), body: String(item.description ?? ""), posted_at: item.postdate ? String(item.postdate) : null });
        }
      } catch (error) { errors.push(`naver:${type}:${error instanceof Error ? error.message : "unknown"}`); }
    }
  }
  return collected;
}

async function collectHn(config: ReturnType<typeof normalizeConfig>, queries: string[], errors: string[]) {
  if (!config.sources.hn && !config.sources.HN) return [] as RawSignal[];
  const result: RawSignal[] = [];
  for (const query of queries.slice(0, 5)) {
    try {
      const response = await fetch(`https://hn.algolia.com/api/v1/search?tags=story&query=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json() as { hits?: Array<Record<string, unknown>> };
      for (const hit of data.hits ?? []) {
        const id = String(hit.objectID ?? "");
        result.push({ source: "hn", source_id: id, url: String(hit.url ?? `https://news.ycombinator.com/item?id=${id}`), title: normalizeNaverText(String(hit.title ?? "")), body: normalizeNaverText(String(hit.story_text ?? hit.title ?? "")), posted_at: String(hit.created_at ?? "") || null });
      }
    } catch (error) { errors.push(`hn:${error instanceof Error ? error.message : "unknown"}`); }
  }
  return result.slice(0, DEFAULT_LIMITS.ITEMS_PER_SOURCE.hn);
}

async function collectThreads(config: ReturnType<typeof normalizeConfig>, queries: string[], errors: string[]) {
  if (!config.sources.threads && !config.sources.Threads) return [] as RawSignal[];
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!token) { errors.push("threads:access-token-missing"); return []; }
  const result: RawSignal[] = [];
  for (const query of queries.slice(0, 20)) {
    try {
      const url = new URL("https://graph.threads.net/v1.0/keyword_search");
      url.searchParams.set("q", query); url.searchParams.set("search_type", "RECENT");
      url.searchParams.set("fields", "id,text,permalink,timestamp,username,has_replies"); url.searchParams.set("access_token", token);
      const response = await fetch(url); const data = await response.json() as { data?: Array<Record<string, unknown>> };
      for (const item of data.data ?? []) result.push({ source: "threads", source_id: String(item.id), url: String(item.permalink), title: `@${String(item.username ?? "threads")}`, body: String(item.text ?? ""), posted_at: String(item.timestamp ?? "") || null });
    } catch (error) { errors.push(`threads:${error instanceof Error ? error.message : "unknown"}`); }
  }
  return result.slice(0, DEFAULT_LIMITS.ITEMS_PER_SOURCE.threads);
}

async function collectAppReviews(config: ReturnType<typeof normalizeConfig>, errors: string[]) {
  if (!config.sources.appstore && !config.sources["앱리뷰"]) return [] as RawSignal[];
  const result: RawSignal[] = [];
  for (const app of config.app_list.filter(a => a.platform === "ios")) {
    try {
      const country = app.country ?? "kr";
      const response = await fetch(`https://itunes.apple.com/${country}/rss/customerreviews/id=${encodeURIComponent(app.appId)}/sortBy=mostRecent/json`);
      const data = await response.json() as { feed?: { entry?: Array<Record<string, unknown>> } };
      for (const entry of data.feed?.entry ?? []) {
        const rating = Number((entry["im:rating"] as { label?: string } | undefined)?.label ?? 5);
        if (rating > 3) continue;
        const id = String((entry.id as { label?: string } | undefined)?.label ?? crypto.randomUUID());
        result.push({ source: "appstore", source_id: id, url: id, title: String((entry.title as { label?: string } | undefined)?.label ?? "저평점 리뷰"), body: String((entry.content as { label?: string } | undefined)?.label ?? ""), posted_at: String((entry.updated as { label?: string } | undefined)?.label ?? "") || null });
      }
    } catch (error) { errors.push(`appstore:${app.appId}:${error instanceof Error ? error.message : "unknown"}`); }
  }
  return result.slice(0, DEFAULT_LIMITS.ITEMS_PER_SOURCE.appstore);
}

function extractJson(text: string) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = Math.min(...[cleaned.indexOf("["), cleaned.indexOf("{")].filter(i => i >= 0));
  return JSON.parse(start >= 0 ? cleaned.slice(start) : cleaned);
}

async function anthropicJson(model: string, prompt: string, maxTokens = 1800) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  let lastError: unknown;
  for (let attempt = 0; attempt <= DEFAULT_LIMITS.LLM_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, messages: [{ role: "user", content: prompt }] }) });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        const detail = payload?.error?.message ?? "요청이 거부되었습니다.";
        const failure = new Error(`Anthropic ${response.status}: ${detail}`);
        if (response.status < 500 && response.status !== 429) throw Object.assign(failure, { nonRetryable: true });
        throw failure;
      }
      const data = await response.json() as { content?: Array<{ type: string; text?: string }> };
      return extractJson(data.content?.find(c => c.type === "text")?.text ?? "");
    } catch (error) {
      lastError = error;
      if (error instanceof Error && "nonRetryable" in error) throw error;
    }
  }
  throw lastError;
}

function fallbackAnalysis(item: RawSignal): Analysis {
  return { pain_summary: item.title || item.body.slice(0, 90), who: "확인 필요", current_workaround: null, frequency: "occasional", money_signal: null, search_terms_for_verification: [item.title], domain: "미분류" };
}

export async function runPipeline(input: RunConfig) {
  const config = normalizeConfig(input);
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const queries = makeQueries(config);
  const collected = await Promise.all([collectNaver(config, queries, errors), collectHn(config, queries, errors), collectThreads(config, queries, errors), collectAppReviews(config, errors)]).then(parts => parts.flat());
  const deduped = [...new Map(collected.map(item => [`${item.source}:${item.source_id}`, item])).values()];
  const filtered = deduped.filter(item => !isJunk(item, config.excluded_domains));
  const stage1: Stage1[] = [];
  let llm1Calls = 0;
  if (process.env.ANTHROPIC_API_KEY) {
    for (let offset = 0; offset < filtered.length && llm1Calls < DEFAULT_LIMITS.LLM1_MAX_CALLS_PER_RUN; offset += 20) {
      const batch = filtered.slice(offset, offset + 20);
      try {
        const result = await anthropicJson(config.model_stage1, `다음 게시물에서 반복 불편, 질문형 수요, 도구 탐색 실패, 임시방편, 포기, 지불 의사 중 하나라도 있으면 넓게 통과시켜라. JSON 배열만 반환: [{"id":"...","pass":true,"type":"1~6","reason":"한 줄"}].\n${JSON.stringify(batch.map((x, i) => ({ id: String(offset + i), title: x.title, body: x.body })))}`) as Stage1[];
        stage1.push(...result); llm1Calls++;
      } catch (error) {
        const message = error instanceof Error ? error.message : "failed";
        errors.push(`llm1:${message}`);
        for (let i = 0; i < batch.length; i++) stage1.push({ id: String(offset + i), pass: false, type: "llm1_failed", reason: "판정 실패" });
        if (/Anthropic 4\d\d/.test(message)) break;
      }
    }
  }
  const passedIndexes = stage1.filter(x => x.pass).map(x => Number(x.id)).filter(Number.isFinite);
  const passed = passedIndexes.map(i => filtered[i]).filter(Boolean).slice(0, DEFAULT_LIMITS.LLM2_MAX_CALLS_PER_RUN);
  const analyses: Array<{ raw: RawSignal; analysis: Analysis; competitors: Array<Record<string, unknown>>; scores: number[] }> = [];
  let llm2Calls = 0; let verifyCalls = 0;
  for (const raw of passed) {
    let analysis = fallbackAnalysis(raw);
    try {
      analysis = await anthropicJson(config.model_stage2, `게시물의 페인포인트를 분석해 JSON 객체만 반환하라: {"pain_summary":"누가 무엇 때문에 불편한가","who":"직업/역할","current_workaround":null,"frequency":"daily|weekly|monthly|occasional","money_signal":null,"search_terms_for_verification":["검색어 3개"],"domain":"태그"}.\n${JSON.stringify(raw)}`) as Analysis; llm2Calls++;
    } catch (error) { errors.push(`llm2:${error instanceof Error ? error.message : "failed"}`); }
    const competitors: Array<Record<string, unknown>> = [];
    if (verifyCalls < DEFAULT_LIMITS.VERIFY_MAX_PER_RUN && process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) {
      for (const term of analysis.search_terms_for_verification.slice(0, 3)) {
        try {
          const found = await searchNaver({ type: "webkr", query: term, display: 5, sort: "sim", clientId: process.env.NAVER_CLIENT_ID, clientSecret: process.env.NAVER_CLIENT_SECRET });
          for (const item of found) competitors.push({ name: item.title, url: item.link, pricing: null, quality_note: item.description, last_updated_signal: null });
        } catch (error) { errors.push(`verify:${error instanceof Error ? error.message : "failed"}`); }
      }
      verifyCalls++;
    }
    const uniqueCompetitors = [...new Map(competitors.map(c => [String(c.url), c])).values()].slice(0, 8);
    const scores = [analysis.current_workaround ? 2 : 1, 1, 2, uniqueCompetitors.length > 1 ? 2 : 1, analysis.money_signal ? 2 : 0, 1];
    analyses.push({ raw, analysis, competitors: uniqueCompetitors, scores });
  }
  const stageCounts = { collected: deduped.length, rulePassed: filtered.length, llm1Passed: passed.length, llm2Analyzed: analyses.length, verified: analyses.filter(a => a.competitors.length > 0).length };
  const costEstimate = Number((llm1Calls * .004 + llm2Calls * .012 + verifyCalls * .025).toFixed(4));
  return { mode: collected.length || process.env.ANTHROPIC_API_KEY ? "live" : "demo", config, startedAt, endedAt: new Date().toISOString(), queries, stageCounts, llmCalls: { stage1: llm1Calls, stage2: llm2Calls, verify: verifyCalls }, costEstimate, stoppedReason: costEstimate >= config.limits.dailyCostUsd ? "daily_cost_ceiling" : null, errors, candidates: analyses };
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
  const created = await supabaseRest("run_logs", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ config_id: result.config.id ?? null, started_at: result.startedAt, ended_at: result.endedAt, stage_counts: result.stageCounts, llm_calls: result.llmCalls, cost_estimate: result.costEstimate, stopped_reason: result.stoppedReason, errors: result.errors }) }) as Array<{ id: string }> | null;
  const runId = created?.[0]?.id;
  if (!runId || !result.candidates.length) return runId ?? null;
  for (const candidate of result.candidates) {
    const rawRows = await supabaseRest("raw_items?on_conflict=source,source_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ ...candidate.raw, run_id: runId, status: "analyzed" }) }) as Array<{ id: string }>;
    const rawId = rawRows?.[0]?.id; if (!rawId) continue;
    const painRows = await supabaseRest("pain_points?on_conflict=raw_item_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ raw_item_id: rawId, pain_summary: candidate.analysis.pain_summary, who: candidate.analysis.who, current_workaround: candidate.analysis.current_workaround, frequency: candidate.analysis.frequency, money_signal: candidate.analysis.money_signal, domain: candidate.analysis.domain, signal_type: "llm_pass" }) }) as Array<{ id: string }>;
    const painId = painRows?.[0]?.id; if (!painId) continue;
    await supabaseRest("scores?on_conflict=pain_point_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ pain_point_id: painId, f1: candidate.scores[0], f2: candidate.scores[1], f3: candidate.scores[2], f4: candidate.scores[3], f5: candidate.scores[4], f6: candidate.scores[5], data_access_stable: true, verdict: "unreviewed" }) });
    if (candidate.competitors.length) await supabaseRest("competitors", { method: "POST", body: JSON.stringify(candidate.competitors.map(c => ({ ...c, pain_point_id: painId }))) });
  }
  return runId;
}
