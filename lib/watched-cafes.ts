export type WatchedCafe = {
  id?: number;
  cafe_id: string;
  cafe_name: string;
  topic_seeds: string[];
  active: boolean;
};

export const WATCHED_CAFE_QUERY_SLOTS = 4;

const COMPLAINT_SUFFIXES = ["다들 어떻게", "방법이 없을까", "불편", "힘들어요"];

const TOPIC_STOPWORDS = new Set([
  "관리", "업무", "회사", "담당자", "사용자", "사람", "문제", "불편", "상황", "방법",
  "관련", "대한", "위해", "때문", "카페", "네이버", "있다", "없다", "하는", "해야",
]);

export function normalizeTopicSeeds(value: unknown) {
  const values = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[\n,]/);
  return [...new Set(values.map(item => String(item).replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 30);
}

export function parseNaverCafeId(rawUrl: unknown) {
  try {
    const url = new URL(String(rawUrl ?? ""));
    if (!["cafe.naver.com", "www.cafe.naver.com", "m.cafe.naver.com"].includes(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "f-e" && parts[1] === "cafes" && /^\d+$/.test(parts[2] ?? "")) return parts[2];
    if (parts[0] === "ca-fe" && parts[1] === "web" && parts[2] === "cafes" && /^\d+$/.test(parts[3] ?? "")) return parts[3];
    const clubId = url.searchParams.get("clubid");
    if (/^\d+$/.test(clubId ?? "")) return clubId;
    const [first] = parts;
    if (!first || first.includes(".") || first === "ca-fe" || first === "f-e") return null;
    return decodeURIComponent(first);
  } catch {
    return null;
  }
}

function topicToken(value: string) {
  return value
    .replace(/[^가-힣A-Za-z0-9+#._-]+/g, " ")
    .split(/\s+/)
    .map(token => token.replace(/(?:으로|에서|에게|까지|부터|처럼|하고|하며|하는|해야|된다|되어|이다|있다|없다|한다|들이)$/g, ""))
    .map(token => token.trim())
    .filter(token => token.length >= 2 && token.length <= 24 && !TOPIC_STOPWORDS.has(token));
}

export function inferWatchedCafeTopicSeeds(
  candidates: Array<{ domain?: unknown; painSummary?: unknown }>,
  fallbackDomain?: unknown,
  limit = 8,
) {
  const scores = new Map<string, number>();
  const add = (term: string, weight: number) => {
    const normalized = term.replace(/\s+/g, " ").trim();
    if (normalized.length < 2 || TOPIC_STOPWORDS.has(normalized)) return;
    scores.set(normalized, (scores.get(normalized) ?? 0) + weight);
  };
  const fallback = String(fallbackDomain ?? "").replace(/\s+/g, " ").trim();
  if (fallback) add(fallback, 100);
  for (const candidate of candidates) {
    const domain = String(candidate.domain ?? "").replace(/\s+/g, " ").trim();
    if (domain) add(domain, 12);
    for (const token of topicToken(String(candidate.painSummary ?? ""))) add(token, 1);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko-KR"))
    .slice(0, Math.max(1, limit))
    .map(([term]) => term);
}

export function buildWatchedCafeQueries(cafes: WatchedCafe[], limit = WATCHED_CAFE_QUERY_SLOTS) {
  const active = cafes.filter(cafe => cafe.active && cafe.cafe_id && cafe.topic_seeds.length);
  const queries: Array<{ query: string; cafeId: string }> = [];
  let round = 0;
  while (queries.length < limit && active.length) {
    let added = false;
    for (let cafeIndex = 0; cafeIndex < active.length && queries.length < limit; cafeIndex++) {
      const cafe = active[cafeIndex];
      const seed = cafe.topic_seeds[round % cafe.topic_seeds.length];
      const suffix = COMPLAINT_SUFFIXES[(round + cafeIndex) % COMPLAINT_SUFFIXES.length];
      const query = `${seed} ${suffix}`;
      if (!queries.some(item => item.query === query)) {
        queries.push({ query, cafeId: cafe.cafe_id });
        added = true;
      }
    }
    round++;
    if (!added || round > 100) break;
  }
  return queries;
}

export function matchWatchedCafe(rawUrl: unknown, cafes: WatchedCafe[]) {
  const cafeId = parseNaverCafeId(rawUrl);
  if (!cafeId) return null;
  return cafes.find(cafe => cafe.active && cafe.cafe_id.toLocaleLowerCase("ko-KR") === cafeId.toLocaleLowerCase("ko-KR")) ?? null;
}
