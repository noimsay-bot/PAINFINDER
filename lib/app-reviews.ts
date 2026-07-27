import gplay from "google-play-scraper";

export type ReviewPlatform = "ios" | "android";

export type ReviewApp = {
  id: number | string | null;
  name: string;
  ios_app_id: string | null;
  android_package: string | null;
  ios_url: string | null;
  android_url: string | null;
  active: boolean;
};

export type AppSearchCandidate = {
  platform: ReviewPlatform;
  name: string;
  appId: string;
  url: string;
  developer: string | null;
  icon: string | null;
};

export const APP_REVIEW_MAX_PER_APP = 100;
export const PLAY_SCRAPE_DELAY_MS = 1_250;

export function isPlayScrapeEnabled(value = process.env.ENABLE_PLAY_SCRAPE) {
  return String(value ?? "true").trim().toLocaleLowerCase("en-US") !== "false";
}

export function isPlayBlockError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(?:\b403\b|\b429\b|forbidden|too many requests|rate.?limit|blocked|captcha)/i.test(message);
}

export function hasIncumbentDissatisfaction(text: string) {
  return /(?:다른|대체|새(?:로운)?)[\s\S]{0,18}(?:앱|어플|서비스)[\s\S]{0,16}(?:찾|갈아타|옮기|바꾸)|(?:앱|어플|서비스)[\s\S]{0,16}(?:떠나|삭제|갈아타)/i.test(text);
}

export function isSpecificReviewPain(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length < 15) return false;
  const featureSignal = /(?:기능|설정|옵션|검색|정렬|필터|연동|동기화|내보내기|백업|알림|로그인|공유|저장|입력|삭제|편집|업로드|다운로드|위젯|다크모드)/i.test(normalized);
  const requestSignal = /(?:있으면 좋|추가해|지원해|개선해|안 돼|안되|못하|불편|찾는다|갈아타|바꾸려|필요하)/i.test(normalized);
  const vagueOnly = /^(?:정말\s*)?(?:별로|최악|구려|느려|불편)(?:해요|합니다|임|다)?[.!\s]*$/i.test(normalized);
  return !vagueOnly && featureSignal && requestSignal;
}

export function sameAppPain(a: string, b: string) {
  const tokens = (value: string) => new Set(value.toLocaleLowerCase("ko-KR").replace(/[^a-z0-9가-힣\s]/g, " ").split(/\s+/).filter(token => token.length >= 2));
  const left = tokens(a);
  const right = tokens(b);
  const overlap = [...left].filter(token => right.has(token)).length;
  return overlap >= 2 && overlap / Math.max(1, Math.min(left.size, right.size)) >= .4;
}

export async function searchReviewApps(term: string): Promise<{ results: AppSearchCandidate[]; errors: string[] }> {
  const query = term.trim();
  if (!query) return { results: [], errors: [] };
  const errors: string[] = [];
  const [ios, android] = await Promise.allSettled([
    (async () => {
      const url = new URL("https://itunes.apple.com/search");
      url.searchParams.set("term", query);
      url.searchParams.set("country", "kr");
      url.searchParams.set("entity", "software");
      url.searchParams.set("limit", "8");
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`iTunes ${response.status}`);
      const payload = await response.json() as { results?: Array<Record<string, unknown>> };
      return (payload.results ?? []).flatMap((app): AppSearchCandidate[] => {
        const appId = String(app.trackId ?? "");
        if (!appId) return [];
        return [{ platform: "ios", name: String(app.trackName ?? appId), appId, url: String(app.trackViewUrl ?? ""), developer: String(app.sellerName ?? "") || null, icon: String(app.artworkUrl100 ?? "") || null }];
      });
    })(),
    isPlayScrapeEnabled()
      ? gplay.search({ term: query, num: 8, lang: "ko", country: "kr" }).then(apps => apps.map((app): AppSearchCandidate => ({ platform: "android", name: app.title, appId: app.appId, url: app.url, developer: app.developer || null, icon: app.icon || null })))
      : Promise.resolve([] as AppSearchCandidate[]),
  ]);
  if (ios.status === "rejected") errors.push(`itunes:${ios.reason instanceof Error ? ios.reason.message : "failed"}`);
  if (android.status === "rejected") errors.push(`play:${android.reason instanceof Error ? android.reason.message : "failed"}`);
  return {
    results: [...(ios.status === "fulfilled" ? ios.value : []), ...(android.status === "fulfilled" ? android.value : [])],
    errors,
  };
}

export async function fetchPlayReviews(appId: string, num: number) {
  return gplay.reviews({
    appId,
    lang: "ko",
    country: "kr",
    sort: 2,
    num: Math.min(APP_REVIEW_MAX_PER_APP, Math.max(1, num)),
    paginate: false,
  });
}

export async function playScrapeDelay(ms = PLAY_SCRAPE_DELAY_MS) {
  const safeMs = Math.min(2_000, Math.max(1_000, ms));
  await new Promise(resolve => setTimeout(resolve, safeMs));
}
