export type NaverSearchType = "cafearticle" | "kin" | "blog" | "webkr";

export function normalizeNaverText(value: string): string {
  return value
    .replace(/<\/?b>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeNaverPostdate(value: unknown): string | null {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00+09:00` : text || null;
}

export async function searchNaver(params: {
  type: NaverSearchType;
  query: string;
  display?: number;
  start?: number;
  sort?: "date" | "sim";
  clientId: string;
  clientSecret: string;
}): Promise<Array<Record<string, unknown> & { title: string; description: string }>> {
  const { type, query, clientId, clientSecret } = params;
  const url = new URL(`https://openapi.naver.com/v1/search/${type}.json`);
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(Math.min(params.display ?? 100, 100)));
  url.searchParams.set("start", String(Math.min(params.start ?? 1, 1000)));
  url.searchParams.set("sort", params.sort ?? "date");

  const response = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
  });
  if (!response.ok) throw new Error(`Naver search failed: ${response.status}`);
  const data = await response.json() as { items?: Array<Record<string, unknown>> };
  return (data.items ?? []).map((item) => ({
    ...item,
    raw_payload: item,
    highlight_terms: [...String(item.title ?? "").matchAll(/<b>(.*?)<\/b>/gi), ...String(item.description ?? "").matchAll(/<b>(.*?)<\/b>/gi)]
      .map(match => normalizeNaverText(String(match[1] ?? "")))
      .filter(Boolean),
    title: normalizeNaverText(String(item.title ?? "")),
    description: normalizeNaverText(String(item.description ?? "")),
  }));
}
