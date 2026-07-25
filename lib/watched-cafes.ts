export type WatchedCafe = {
  id?: number;
  cafe_id: string;
  cafe_name: string;
  topic_seeds: string[];
  active: boolean;
};

export const WATCHED_CAFE_QUERY_SLOTS = 4;

const COMPLAINT_SUFFIXES = ["다들 어떻게", "방법이 없을까", "불편", "힘들어요"];

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
