function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

export function cafeNameFromHtml(html: string) {
  const metaPatterns = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
  ];
  const raw = metaPatterns.map(pattern => html.match(pattern)?.[1]).find(Boolean)
    ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  if (!raw) return null;
  const name = decodeHtml(raw).replace(/\s*[:|–—-]\s*네이버\s*카페\s*$/i, "").trim();
  return name && !/^네이버\s*카페$/i.test(name) ? name.slice(0, 120) : null;
}

export function isUsableCafeName(value: unknown, cafeId = "") {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  return name.length >= 2
    && !name.includes("\uFFFD")
    && name.toLocaleLowerCase("ko-KR") !== cafeId.toLocaleLowerCase("ko-KR");
}

export async function fetchNaverCafeName(cafeId: string) {
  try {
    const response = await fetch(`https://cafe.naver.com/${encodeURIComponent(cafeId)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Painfinder/1.0; +https://painfinder-murex.vercel.app)" },
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const headerCharset = response.headers.get("content-type")?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] ?? "";
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
    const metaCharset = head.match(/charset\s*=\s*["']?([^;"'\s/>]+)/i)?.[1] ?? "";
    const declaredCharset = headerCharset || metaCharset;
    const encoding = /euc-?kr|ks_?c_?5601|cp949|ms949/i.test(declaredCharset) ? "euc-kr" : "utf-8";
    const cafeName = cafeNameFromHtml(new TextDecoder(encoding).decode(bytes));
    if (!cafeName) throw new Error("카페명 메타데이터 없음");
    return { cafeName, fetchError: null };
  } catch (error) {
    return {
      cafeName: null,
      fetchError: error instanceof Error ? error.message.slice(0, 200) : "조회 실패",
    };
  }
}
