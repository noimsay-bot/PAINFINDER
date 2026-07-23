import { DEFAULT_LIMITS, HARD_LIMITS, RUN_TIME_BUDGET, hasRunProcessingBudget } from "./limits";
import { classifyMarket, createAppMarketSearchContext, mergeProducts, searchAppMarket, verifyMarket, type MarketVerdict, type ProductCompetitor, type VerificationCounts } from "./competitors";
import { getLlmProvider, LlmProviderError, resolveLlmModel, type LlmResult } from "./llm";
import { calculateLlmCost } from "./llm/pricing";
import { normalizeNaverText, searchNaver, type NaverSearchType } from "./naver";
import { classifyFinalRuleRejection, type RuleExclusion } from "./rule-filter";
import { calculateFourScores, type BuyerContext, type FourScores } from "./scoring";

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
  period_days: number;
  auto_verify_top_n: number;
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
  query_text: string | null;
  query_origin: string | null;
};

export type RejectReason = "구직" | "구매문의" | "가격불만" | "신체" | "일회성" | "정보질문" | "학습" | "홍보" | "해결됨" | "기타";
type Stage1 = { id: string; pass: boolean; type?: string; reason?: string; reject_reason?: RejectReason };
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

export function normalizeConfig(input: RunConfig): NormalizedRunConfig {
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
    sources: input.sources ?? { naverCafe: true, naverKin: true, naverBlog: true, appstore: true },
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
  if (text.length < 30) return true;
  if (excluded.some(word => text.includes(word))) return true;
  if (/(문의\s*(주세요|바랍니다)|상담|무료체험\s*신청|오픈채팅|open\.kakao|\d{2,3}-\d{3,4}-\d{4})/i.test(text)) return true;
  if (/\d{1,3}(,\d{3})*\s*원/.test(text) && /(구매|주문|판매|특가|할인)/.test(text)) return true;
  return false;
}

async function collectNaver(config: ReturnType<typeof normalizeConfig>, queries: string[], errors: string[], canContinue: RunGuard) {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [] as RawSignal[];
  const enabled = Object.entries(config.sources).filter(([key, enabled]) => enabled && SOURCE_MAP[key]);
  const collected: RawSignal[] = [];
  for (const [key] of enabled) {
    if (!canContinue()) break;
    const type = SOURCE_MAP[key];
    for (const query of queries) {
      if (!canContinue()) break;
      const sourceCount = collected.filter(i => i.source === type).length;
      const remaining = config.limits.itemsPerSource - sourceCount;
      if (remaining <= 0) break;
      try {
        const fairShare = Math.max(1, Math.ceil(config.limits.itemsPerSource / queries.length));
        const items = await searchNaver({ type, query, display: Math.min(100, fairShare, remaining), sort: "date", clientId, clientSecret });
        for (const item of items.slice(0, remaining)) {
          const url = String(item.link ?? "");
          if (!url) continue;
          collected.push({ source: type, source_id: url, url, title: String(item.title ?? ""), body: String(item.description ?? ""), posted_at: item.postdate ? String(item.postdate) : null, query_text: query, query_origin: config.query_origins[query] ?? "manual" });
        }
      } catch (error) { errors.push(`naver:${type}:${error instanceof Error ? error.message : "unknown"}`); }
    }
  }
  return collected;
}

async function collectHn(config: ReturnType<typeof normalizeConfig>, queries: string[], errors: string[], canContinue: RunGuard) {
  if (!config.sources.hn && !config.sources.HN) return [] as RawSignal[];
  const result: RawSignal[] = [];
  for (const query of queries.slice(0, 5)) {
    if (!canContinue()) break;
    try {
      const response = await fetch(`https://hn.algolia.com/api/v1/search?tags=story&query=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json() as { hits?: Array<Record<string, unknown>> };
      for (const hit of data.hits ?? []) {
        const id = String(hit.objectID ?? "");
        result.push({ source: "hn", source_id: id, url: String(hit.url ?? `https://news.ycombinator.com/item?id=${id}`), title: normalizeNaverText(String(hit.title ?? "")), body: normalizeNaverText(String(hit.story_text ?? hit.title ?? "")), posted_at: String(hit.created_at ?? "") || null, query_text: query, query_origin: config.query_origins[query] ?? "manual" });
      }
    } catch (error) { errors.push(`hn:${error instanceof Error ? error.message : "unknown"}`); }
  }
  return result.slice(0, DEFAULT_LIMITS.ITEMS_PER_SOURCE.hn);
}

async function collectThreads(config: ReturnType<typeof normalizeConfig>, queries: string[], errors: string[], canContinue: RunGuard) {
  if (!config.sources.threads && !config.sources.Threads) return [] as RawSignal[];
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!token) { errors.push("threads:access-token-missing"); return []; }
  const result: RawSignal[] = [];
  for (const query of queries.slice(0, 20)) {
    if (!canContinue()) break;
    try {
      const url = new URL("https://graph.threads.net/v1.0/keyword_search");
      url.searchParams.set("q", query); url.searchParams.set("search_type", "RECENT");
      url.searchParams.set("fields", "id,text,permalink,timestamp,username,has_replies"); url.searchParams.set("access_token", token);
      const response = await fetch(url); const data = await response.json() as { data?: Array<Record<string, unknown>> };
      for (const item of data.data ?? []) result.push({ source: "threads", source_id: String(item.id), url: String(item.permalink), title: `@${String(item.username ?? "threads")}`, body: String(item.text ?? ""), posted_at: String(item.timestamp ?? "") || null, query_text: query, query_origin: config.query_origins[query] ?? "manual" });
    } catch (error) { errors.push(`threads:${error instanceof Error ? error.message : "unknown"}`); }
  }
  return result.slice(0, DEFAULT_LIMITS.ITEMS_PER_SOURCE.threads);
}

async function collectAppReviews(config: ReturnType<typeof normalizeConfig>, errors: string[], canContinue: RunGuard) {
  if (!config.sources.appstore && !config.sources["앱리뷰"]) return [] as RawSignal[];
  const result: RawSignal[] = [];
  for (const app of config.app_list.filter(a => a.platform === "ios")) {
    if (!canContinue()) break;
    try {
      const country = app.country ?? "kr";
      const response = await fetch(`https://itunes.apple.com/${country}/rss/customerreviews/id=${encodeURIComponent(app.appId)}/sortBy=mostRecent/json`);
      const data = await response.json() as { feed?: { entry?: Array<Record<string, unknown>> } };
      for (const entry of data.feed?.entry ?? []) {
        const rating = Number((entry["im:rating"] as { label?: string } | undefined)?.label ?? 5);
        if (rating > 3) continue;
        const id = String((entry.id as { label?: string } | undefined)?.label ?? crypto.randomUUID());
        result.push({ source: "appstore", source_id: id, url: id, title: String((entry.title as { label?: string } | undefined)?.label ?? "저평점 리뷰"), body: String((entry.content as { label?: string } | undefined)?.label ?? ""), posted_at: String((entry.updated as { label?: string } | undefined)?.label ?? "") || null, query_text: null, query_origin: "manual" });
      }
    } catch (error) { errors.push(`appstore:${app.appId}:${error instanceof Error ? error.message : "unknown"}`); }
  }
  return result.slice(0, DEFAULT_LIMITS.ITEMS_PER_SOURCE.appstore);
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
  if (!queries.length) throw new Error("검색어를 1개 이상 입력해 주세요.");
  const collected = canContinue()
    ? await Promise.all([
      collectNaver(config, queries, errors, canContinue),
      collectHn(config, queries, errors, canContinue),
      collectThreads(config, queries, errors, canContinue),
      collectAppReviews(config, errors, canContinue),
    ]).then(parts => parts.flat())
    : [];
  const deduped = [...new Map(collected.map(item => [`${item.source}:${item.source_id}`, item])).values()];
  const filtered = deduped.filter(item => !isJunk(item, config.excluded_domains));
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
  const rejectReasons = new Set<RejectReason>(["구직", "구매문의", "가격불만", "신체", "일회성", "정보질문", "학습", "홍보", "해결됨", "기타"]);
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
        user: `다음 게시물을 엄격히 판정하라. 통과하려면 (1) 일회성이 아닌 반복 업무·생활 불편, (2) 글쓴이 본인 또는 소속 조직이 직접 겪는 문제, (3) 사람·가격·운·시장 상황이 아니라 프로세스나 도구의 문제를 모두 만족해야 한다. 하나라도 불명확하면 탈락시켜라. 즉시 제외: 구직·채용·이직·자기소개서·이력서·면접·일자리 배정, 단순 구매/배송/재고/소량·N개 단위 문의, 가격·수수료 불만, 목·어깨·허리 통증과 눈 피로 같은 신체·건강 문제, 주차·식대·사업장 이전·특정 날짜 같은 일회성 환경 불만, 고장·사고·분쟁·환불 같은 일회성 사건, 단순 정보 질문, 학습·강의·자격증, 홍보·판매·모집, 이미 답변으로 해결된 질문. 통과는 {"id":"...","pass":true,"type":"1~6","reason":"한 줄"}, 탈락은 {"id":"...","pass":false,"reject_reason":"구직|구매문의|가격불만|신체|일회성|정보질문|학습|홍보|해결됨|기타"}로 작성하라. 반드시 {"results":[...]} JSON 객체로 응답하라.\n${JSON.stringify(batch.map((x, i) => ({ id: String(offset + i), title: x.title, body: x.body })))}`,
      });
      llm1Calls++;
      recordUsage(completion);
      const parsed = JSON.parse(completion.text) as { results?: Stage1[] };
      if (!Array.isArray(parsed.results)) throw new Error("LLM 1차 응답에 results 배열이 없습니다.");
      const resultById = new Map(parsed.results.map(result => [String(result.id), result]));
      for (let i = 0; i < batch.length; i++) {
        const id = String(offset + i);
        const result = resultById.get(id);
        const pass = result?.pass === true;
        stage1.push({
          id,
          pass,
          type: pass ? String(result?.type ?? "기타") : undefined,
          reason: pass ? String(result?.reason ?? "반복 프로세스 문제") : undefined,
          reject_reason: pass ? undefined : rejectReasons.has(result?.reject_reason as RejectReason) ? result?.reject_reason : "기타",
        });
      }
    } catch (error) {
      for (let i = 0; i < batch.length; i++) stage1.push({ id: String(offset + i), pass: false, reject_reason: "기타" });
      if (noteLlmError("llm1", error)) break;
    }
  }
  const stage1PassCount = stage1.filter(result => result.pass).length;
  const llm1PassRate = stage1.length ? Number((stage1PassCount / stage1.length).toFixed(4)) : 0;
  if (llm1PassRate > 0.25) errors.push(`warning:llm1:pass-rate-high:${(llm1PassRate * 100).toFixed(1)}%`);
  const rejectReasonCounts = Object.fromEntries([...rejectReasons].map(reason => [reason, stage1.filter(result => !result.pass && result.reject_reason === reason).length]));
  const passedIndexes = stage1.filter(result => result.pass).map(result => Number(result.id)).filter(Number.isFinite);
  const passed = passedIndexes.map(index => filtered[index]).filter(Boolean).slice(0, llm2MaxCalls);
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
    const marketVerdict: MarketVerdict = "unverified";
    analyses.push({
      raw,
      analysis,
      competitors: [],
      marketVerdict,
      scores: calculateFourScores({ aiReplacementScore: analysis.ai_replacement_score, maintenanceScore: analysis.maintenance_score, moneySignal: analysis.money_signal, verdict: marketVerdict, buyerContext: analysis.buyer_context }),
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
      const appVerification = await searchAppMarket(candidate.analysis.domain, appMarketContext);
      candidate.competitors = appVerification.products;
      // App-market lookup is only a partial input. Until precision verification
      // finishes, the market state and incumbent score must remain unknown.
      candidate.marketVerdict = "unverified";
      candidate.scores = calculateFourScores({ aiReplacementScore: candidate.analysis.ai_replacement_score, maintenanceScore: candidate.analysis.maintenance_score, moneySignal: candidate.analysis.money_signal, verdict: "unverified", buyerContext: candidate.analysis.buyer_context });
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
        const verification = await verifyMarket({ searchTerms: candidate.analysis.search_terms_for_verification, llm, model: verifyModel, naverClientId: process.env.NAVER_CLIENT_ID, naverClientSecret: process.env.NAVER_CLIENT_SECRET });
        candidate.competitors = mergeProducts(candidate.competitors, verification.products);
        candidate.marketVerdict = classifyMarket(candidate.competitors);
        candidate.scores = calculateFourScores({ aiReplacementScore: candidate.analysis.ai_replacement_score, maintenanceScore: candidate.analysis.maintenance_score, moneySignal: candidate.analysis.money_signal, verdict: candidate.marketVerdict, buyerContext: candidate.analysis.buyer_context });
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
    collected: deduped.length,
    rulePassed: filtered.length,
    llm1Evaluated: stage1.length,
    llm1Passed: stage1PassCount,
    llm1_pass_rate: llm1PassRate,
    reject_reason_counts: rejectReasonCounts,
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
  const exclusionRows = await supabaseRest("rule_exclusions?active=eq.true&select=kind,value&limit=1000") as Array<{ kind: string; value: string }> | null;
  const exclusions = (exclusionRows ?? []).filter((row): row is RuleExclusion => ["keyword", "domain"].includes(row.kind) && Boolean(row.value));
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
  const stageCounts = { ...result.stageCounts, finalRuleRejected: finalRejectByKey.size };
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
    rawByKey.set(rawKey(candidate.raw.source, candidate.raw.source_id), {
      ...candidate.raw,
      run_id: runId,
      status: finalRejectReason ? "rule_rejected" : "analyzed",
      reject_reason: finalRejectReason ?? null,
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
      data_access_stable: true,
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
