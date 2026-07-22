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
    title: normalizeNaverText(String(item.title ?? "")),
    description: normalizeNaverText(String(item.description ?? "")),
  }));
}
