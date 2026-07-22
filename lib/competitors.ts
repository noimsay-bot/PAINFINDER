import type { LlmProvider, LlmResult } from "./llm";
import { normalizeNaverText, searchNaver } from "./naver";

export const NOT_A_PRODUCT_HOSTS = [
  "blog.naver.com", "m.blog.naver.com", "post.naver.com",
  "cafe.naver.com", "cafe.daum.net", "blog.daum.net",
  "tistory.com", "brunch.co.kr", "velog.io", "medium.com",
  "steemit.com", "wordpress.com", "blogspot.com",
  "kin.naver.com", "namu.wiki", "wikipedia.org", "terms.naver.com",
  "dcinside.com", "arca.live", "fmkorea.com", "clien.net",
  "ppomppu.co.kr", "ruliweb.com", "inven.co.kr", "bobaedream.co.kr",
  "news.naver.com", "n.news.naver.com", "v.daum.net",
  "youtube.com", "youtu.be", "instagram.com", "facebook.com",
  "threads.net", "x.com", "twitter.com", "tiktok.com",
  "smartstore.naver.com", "coupang.com", "gmarket.co.kr",
  "saramin.co.kr", "jobkorea.co.kr", "wanted.co.kr",
  "slideshare.net", "scribd.com",
  "kyobobook.co.kr", "ebook-product.kyobobook.co.kr", "yes24.com",
  "aladin.co.kr", "ridibooks.com", "millie.co.kr",
  "kmong.com", "soomgo.com", "wishket.com", "freemoa.net",
  "inflearn.com", "fastcampus.co.kr", "class101.net", "udemy.com",
] as const;

const CONTENT_PATH = /\/(blog|post|news|article|board)(\/|$)/i;
const REVIEW_TITLE = /(추천|비교|후기|순위|\btop\b|정리|방법)/i;
const DOCUMENT_EXTENSION = /\.(pdf|xlsx|hwp)(?:$|[?#])/i;
const PUBLIC_DOWNLOAD_PATH = /(download|exldown|getlist|\.pdf(?:$|[?#]))/i;

export type CompetitorPricing = "free" | "freemium" | "paid" | "public" | "unknown";
export type MarketVerdict = "empty" | "all_free" | "public_owned" | "paid_exists" | "crowded";
export type CompetitorSource = "appstore" | "web";

export type SearchCandidate = { title: string; snippet: string; url: string; reviewLike: boolean };
export type ProductCompetitor = {
  name: string;
  url: string;
  pricing: CompetitorPricing;
  quality_note: string;
  last_updated_signal: string | null;
  seller_name: string | null;
  source: CompetitorSource;
};
export type VerificationCounts = { urlExcluded: number; product: number; content: number; irrelevant: number; appProduct: number };

function hostnameMatches(hostname: string, blocked: string) {
  const host = hostname.replace(/^www\./, "");
  return host === blocked || host.endsWith(`.${blocked}`);
}

export function isProductCandidateUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    const pathAndSearch = `${url.pathname}${url.search}`;
    if (NOT_A_PRODUCT_HOSTS.some(blocked => hostnameMatches(hostname, blocked))) return false;
    if (CONTENT_PATH.test(url.pathname) || DOCUMENT_EXTENSION.test(pathAndSearch)) return false;
    if (hostname.endsWith(".go.kr") && PUBLIC_DOWNLOAD_PATH.test(pathAndSearch)) return false;
    return url.protocol === "http:" || url.protocol === "https:";
  } catch { return false; }
}

export function filterProductCandidates(rows: Array<Record<string, unknown>>, limit = 10) {
  const accepted: SearchCandidate[] = [];
  const seen = new Set<string>();
  let excluded = 0;
  for (const row of rows) {
    const rawUrl = String(row.link ?? row.url ?? "");
    if (!isProductCandidateUrl(rawUrl)) { excluded++; continue; }
    let canonical = rawUrl;
    try {
      const url = new URL(rawUrl);
      url.hash = "";
      canonical = url.toString();
    } catch { /* validated above */ }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const title = normalizeNaverText(String(row.title ?? ""));
    accepted.push({
      title,
      snippet: normalizeNaverText(String(row.description ?? row.snippet ?? "")),
      url: canonical,
      reviewLike: REVIEW_TITLE.test(title),
    });
    if (accepted.length >= limit) break;
  }
  return { candidates: accepted, excluded };
}

function normalizePricing(value: unknown): CompetitorPricing {
  return ["free", "freemium", "paid", "public", "unknown"].includes(String(value))
    ? String(value) as CompetitorPricing
    : "unknown";
}

function isPublicHost(rawUrl: string) {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return hostname.endsWith(".go.kr") || hostname.endsWith(".or.kr");
  } catch { return false; }
}

export function mergeProducts(...groups: ProductCompetitor[][]) {
  return [...new Map(groups.flat().map(product => [product.url.toLowerCase(), product])).values()];
}

export function classifyMarket(products: ProductCompetitor[]): MarketVerdict {
  if (!products.length) return "empty";
  if (products.some(product => product.pricing === "public")) return "public_owned";
  const paidCount = products.filter(product => product.pricing === "paid" || product.pricing === "freemium").length;
  if (paidCount >= 5) return "crowded";
  if (paidCount >= 1) return "paid_exists";
  return "all_free";
}

export function scoreMarket(verdict: MarketVerdict) {
  return ({ paid_exists: 3, empty: 2, crowded: 1, all_free: 0, public_owned: 0 } as const)[verdict];
}

export function buildAppSearchTerms(domain: string) {
  const core = normalizeNaverText(domain)
    .replace(/[|/>,].*$/, "")
    .replace(/^(미분류|기타|일반)$/i, "")
    .trim()
    .slice(0, 30);
  if (!core) return [];
  const bare = core.replace(/\s*(관리|시스템|서비스|프로그램|앱)$/i, "").trim() || core;
  return [...new Set([`${bare} 관리`, `${bare} 프로그램`, core])].slice(0, 3);
}

export function buildPrecisionSearchTerms(domain: string) {
  const core = normalizeNaverText(domain).replace(/[|/>,].*$/, "").trim().slice(0, 30);
  if (!core || /^(미분류|기타|일반)$/i.test(core)) return [];
  return [`${core} 프로그램`, `${core} 솔루션`, `${core} 관리 시스템`];
}

export async function searchAppMarket(domain: string) {
  const errors: string[] = [];
  const products: ProductCompetitor[] = [];
  const queries = buildAppSearchTerms(domain);
  for (const term of queries) {
    try {
      const url = new URL("https://itunes.apple.com/search");
      url.searchParams.set("term", term);
      url.searchParams.set("country", "kr");
      url.searchParams.set("entity", "software");
      url.searchParams.set("limit", "10");
      let response = await fetch(url);
      if (response.status === 429) {
        const retryAfterSeconds = Math.min(Number(response.headers.get("retry-after") ?? 1) || 1, 3);
        await new Promise(resolve => setTimeout(resolve, retryAfterSeconds * 1000));
        response = await fetch(url);
      }
      if (!response.ok) throw new Error(`iTunes ${response.status}`);
      const payload = await response.json() as { results?: Array<Record<string, unknown>> };
      for (const app of payload.results ?? []) {
        const appUrl = String(app.trackViewUrl ?? "");
        if (!appUrl) continue;
        const formattedPrice = String(app.formattedPrice ?? "").trim();
        const pricing: CompetitorPricing = /^(무료|free)$/i.test(formattedPrice) ? "free" : formattedPrice ? "paid" : "unknown";
        const details = ["App Store", String(app.primaryGenreName ?? "").trim(), formattedPrice, app.averageUserRating ? `평점 ${Number(app.averageUserRating).toFixed(1)}` : ""].filter(Boolean).join(" · ");
        products.push({
          name: String(app.trackName ?? "앱 이름 미상"),
          url: appUrl,
          pricing,
          quality_note: details,
          last_updated_signal: String(app.currentVersionReleaseDate ?? "") || null,
          seller_name: String(app.sellerName ?? "") || null,
          source: "appstore",
        });
      }
    } catch (error) { errors.push(`itunes:${term}:${error instanceof Error ? error.message : "failed"}`); }
  }
  const unique = mergeProducts(products);
  return { products: unique, verdict: classifyMarket(unique), queries, counts: { appProduct: unique.length }, errors };
}

export async function verifyMarket(opts: {
  searchTerms: string[];
  llm: LlmProvider;
  model: string;
  naverClientId?: string;
  naverClientSecret?: string;
}) {
  const errors: string[] = [];
  const webRows: Array<Record<string, unknown>> = [];
  if (opts.naverClientId && opts.naverClientSecret) {
    for (const term of opts.searchTerms.slice(0, 3)) {
      try {
        webRows.push(...await searchNaver({ type: "webkr", query: term, display: 5, sort: "sim", clientId: opts.naverClientId, clientSecret: opts.naverClientSecret }));
      } catch (error) { errors.push(`verify:${term}:${error instanceof Error ? error.message : "failed"}`); }
    }
  }

  const filtered = filterProductCandidates(webRows, 10);
  const counts: VerificationCounts = { urlExcluded: filtered.excluded, product: 0, content: 0, irrelevant: 0, appProduct: 0 };
  const products: ProductCompetitor[] = [];
  let usage: LlmResult | null = null;

  if (filtered.candidates.length) {
    usage = await opts.llm.complete({
      model: opts.model,
      jsonMode: true,
      maxOutputTokens: 1800,
      system: "너는 검색 결과가 실제 구매·가입·다운로드 가능한 제품의 공식 페이지인지 엄격히 분류한다. 반드시 유효한 JSON 객체로만 응답하라.",
      user: `각 결과를 다음 기준으로 분류하라. product는 실제로 가입·구매·다운로드할 수 있는 서비스나 소프트웨어의 공식 제품 페이지다. 전자책·문서·다운로드 파일·외주 판매·프리랜서 중개·강의·소개·비교·리뷰·뉴스는 모두 content다. irrelevant는 검증 주제와 무관하다. reviewLike가 true이면 content 가능성을 특히 엄격히 확인하라. pricing은 public(정부·공공기관·협회가 무료 제공), free(완전 무료 명시), freemium 또는 paid(요금제·가격·무료체험 언급), unknown(판단 불가) 중 하나다. 반드시 {"results":[{"url":"...","kind":"product|content|irrelevant","name":"제품명","pricing":"free|freemium|paid|public|unknown","note":"한 줄 설명"}]} 형태로 응답하라.\n${JSON.stringify(filtered.candidates)}`,
    });
    const parsed = JSON.parse(usage.text) as { results?: Array<Record<string, unknown>> };
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    const byUrl = new Map(results.map(result => [String(result.url ?? ""), result]));
    for (const candidate of filtered.candidates) {
      const result = byUrl.get(candidate.url);
      const kind = ["product", "content", "irrelevant"].includes(String(result?.kind)) ? String(result?.kind) : "irrelevant";
      if (kind === "content") { counts.content++; continue; }
      if (kind === "irrelevant") { counts.irrelevant++; continue; }
      counts.product++;
      products.push({
        name: String(result?.name ?? candidate.title),
        url: candidate.url,
        pricing: isPublicHost(candidate.url) ? "public" : normalizePricing(result?.pricing),
        quality_note: String(result?.note ?? candidate.snippet).trim() || "설명 없음",
        last_updated_signal: null,
        seller_name: null,
        source: "web",
      });
    }
  }

  const unique = mergeProducts(products);
  return { products: unique, verdict: classifyMarket(unique), counts, usage, errors };
}
