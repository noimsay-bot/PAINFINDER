import { NextResponse } from "next/server";
import { isActiveIndustryCode, isSoftwareRelevantVocabulary, ksicSection, rankCafeStats, sanitizeIndustryTranslation } from "@/lib/discovery";
import { getLlmProvider, resolveLlmModel } from "@/lib/llm";
import { KSIC_SEEDS } from "@/lib/ksic-seeds";
import { supabaseRest } from "@/lib/pipeline";
import { parseNaverCafeId } from "@/lib/watched-cafes";
import { fetchNaverCafeName, isUsableCafeName } from "@/lib/cafe-names";

export const runtime = "nodejs";
export const maxDuration = 300;

type Row = Record<string, unknown>;
type DiscoveryOrigin = "cafe" | "text_mining" | "industry";
type DiscoveryInput = { origin: DiscoveryOrigin; term: string; category: string; source_ref: string; frequency: number };

const STOPWORDS = new Set([
  "그리고", "그런데", "하지만", "때문에", "관련", "대한", "있는", "없는", "합니다", "입니다", "하는", "해서", "정도", "경우", "이번", "그냥", "요즘", "제가", "저는", "우리", "문의", "질문", "카페", "네이버",
]);

const cafeIdFromUrl = parseNaverCafeId;

function usefulTokens(text: string) {
  return text.match(/[가-힣]{2,}|[A-Za-z][A-Za-z0-9._+-]{1,}/g)?.map(value => value.trim()).filter(value => !STOPWORDS.has(value) && !/^https?$/i.test(value)) ?? [];
}

function normalizeTerm(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim().slice(0, 80);
}

async function fetchAndCacheCafeName(cafeId: string) {
  const { cafeName, fetchError } = await fetchNaverCafeName(cafeId);
  await supabaseRest("cafe_names?on_conflict=cafe_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ cafe_id: cafeId, cafe_name: cafeName, fetched_at: new Date().toISOString(), fetch_error: fetchError }),
  });
  return cafeName;
}

async function existingSeedTerms() {
  const rows = await supabaseRest("seed_queries?select=query_text&limit=5000") as Row[] | null;
  return new Set((rows ?? []).map(row => normalizeTerm(row.query_text).toLocaleLowerCase("ko-KR")));
}

async function saveDiscoveries(inputs: DiscoveryInput[]) {
  if (!inputs.length) return [];
  const seeds = await existingSeedTerms();
  const unique = [...new Map(inputs
    .map(input => ({ ...input, term: normalizeTerm(input.term) }))
    .filter(input => input.term.length >= 2 && !seeds.has(input.term.toLocaleLowerCase("ko-KR")))
    .map(input => [`${input.origin}:${input.category}:${input.source_ref}:${input.term.toLocaleLowerCase("ko-KR")}`, input])).values()];
  if (!unique.length) return [];
  return await supabaseRest("query_discoveries?on_conflict=origin,term,category,source_ref", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(unique),
  }) as Row[] | null ?? [];
}

async function ensureIndustrySeeds() {
  const currentRows = await supabaseRest("industry_seeds?select=ksic_code&limit=1000") as Row[] | null;
  const known = new Set((currentRows ?? []).map(row => String(row.ksic_code)));
  const missing = KSIC_SEEDS.filter(([code]) => !known.has(code));
  for (let offset = 0; offset < missing.length; offset += 100) {
    await supabaseRest("industry_seeds?on_conflict=ksic_code", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify(missing.slice(offset, offset + 100).map(([ksic_code, ksic_name]) => ({
        ksic_code,
        ksic_name,
        section: ksicSection(ksic_code),
        active: isActiveIndustryCode(ksic_code),
      }))),
    });
  }
}

async function loadCafeStats() {
  const rows = await supabaseRest("raw_items?source=eq.cafearticle&select=url,title,body,status&order=collected_at.desc&limit=5000") as Row[] | null;
  const stats = new Map<string, { cafeId: string; cafeName: string | null; collected: number; passed: number; text: string[] }>();
  for (const row of rows ?? []) {
    const cafeId = cafeIdFromUrl(row.url);
    if (!cafeId) continue;
    const item = stats.get(cafeId) ?? { cafeId, cafeName: null, collected: 0, passed: 0, text: [] };
    item.collected++;
    if (["llm1_passed", "analyzed"].includes(String(row.status))) item.passed++;
    item.text.push(`${String(row.title ?? "")} ${String(row.body ?? "")}`);
    stats.set(cafeId, item);
  }
  const ranked = rankCafeStats([...stats.values()].map(item => ({
    cafeId: item.cafeId,
    cafeName: item.cafeName,
    collected: item.collected,
    passed: item.passed,
    passRate: item.collected ? item.passed / item.collected : 0,
  })));
  const main = ranked.filter(item => item.collected >= 5);
  const insufficient = ranked.filter(item => item.collected < 5);
  const cachedRows = await supabaseRest("cafe_names?select=cafe_id,cafe_name,fetched_at,fetch_error&limit=1000") as Row[] | null;
  const cached = new Map((cachedRows ?? []).map(row => [String(row.cafe_id), row]));
  const missing = main.filter(item => !isUsableCafeName(cached.get(item.cafeId)?.cafe_name));
  let cursor = 0;
  const worker = async () => {
    while (cursor < missing.length) {
      const item = missing[cursor++];
      item.cafeName = await fetchAndCacheCafeName(item.cafeId);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, missing.length) }, () => worker()));
  for (const item of main) {
    const row = cached.get(item.cafeId);
    if (isUsableCafeName(row?.cafe_name)) item.cafeName = String(row?.cafe_name);
  }
  return { main, insufficient };
}

async function discoveryPayload() {
  await ensureIndustrySeeds();
  const [cafeStats, discoveryRows, industries, seedRows] = await Promise.all([
    loadCafeStats(),
    supabaseRest("query_discoveries?approved_at=is.null&select=id,origin,term,category,source_ref,frequency,created_at&order=frequency.desc,created_at.desc&limit=1000") as Promise<Row[] | null>,
    supabaseRest("industry_seeds?active=eq.true&select=id,ksic_code,ksic_name,section,active,note,done,translation,translated_at&order=section.asc,ksic_code.asc&limit=500") as Promise<Row[] | null>,
    supabaseRest("seed_queries?select=id,query_text,origin,active,last_used_at&order=last_used_at.asc.nullsfirst,id.asc&limit=5000") as Promise<Row[] | null>,
  ]);
  const activeIndustryIds = new Set((industries ?? []).map(row => String(row.id)));
  const discoveries = (discoveryRows ?? []).filter(row =>
    row.origin !== "industry" ||
    (activeIndustryIds.has(String(row.source_ref)) && isSoftwareRelevantVocabulary(String(row.term ?? "")))
  );
  return { cafes: cafeStats.main, insufficientCafes: cafeStats.insufficient, discoveries, industries: industries ?? [], seeds: seedRows ?? [] };
}

export async function GET() {
  try { return NextResponse.json(await discoveryPayload()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "검색어 발굴 데이터를 불러오지 못했습니다." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; ids?: number[]; cafeId?: string; industryIds?: number[] };
    if (body.action === "approve") {
      const ids = [...new Set((body.ids ?? []).map(Number).filter(Number.isFinite))].slice(0, 200);
      if (!ids.length) return NextResponse.json({ added: 0 });
      const rows = await supabaseRest(`query_discoveries?id=in.(${ids.join(",")})&approved_at=is.null&select=id,origin,term,category`) as Row[] | null;
      const existing = await existingSeedTerms();
      const additions = (rows ?? []).filter(row => !existing.has(normalizeTerm(row.term).toLocaleLowerCase("ko-KR"))).map(row => ({
        family: "question",
        query_text: normalizeTerm(row.term),
        domain: normalizeTerm(row.category) || "검색어 발굴",
        active: row.origin !== "industry",
        origin: normalizeTerm(row.origin),
      }));
      if (additions.length) await supabaseRest("seed_queries", { method: "POST", body: JSON.stringify(additions) });
      const approvedAt = new Date().toISOString();
      await supabaseRest(`query_discoveries?id=in.(${ids.join(",")})`, { method: "PATCH", body: JSON.stringify({ approved_at: approvedAt }) });
      return NextResponse.json({ added: additions.length, approvedAt });
    }

    if (body.action === "cafe-focus") {
      const cafeId = normalizeTerm(body.cafeId);
      if (!cafeId) return NextResponse.json({ error: "카페 ID가 필요합니다." }, { status: 400 });
      const rows = await supabaseRest("raw_items?source=eq.cafearticle&select=url,title,body&order=collected_at.desc&limit=5000") as Row[] | null;
      const relevant = (rows ?? []).filter(row => cafeIdFromUrl(row.url) === cafeId).slice(0, 200);
      const counts = new Map<string, number>();
      for (const row of relevant) for (const token of usefulTokens(`${String(row.title ?? "")} ${String(row.body ?? "")}`)) counts.set(token, (counts.get(token) ?? 0) + 1);
      const suggestions = [...counts].filter(([, frequency]) => frequency >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([term, frequency]) => ({
        origin: "cafe" as const, term: `${term} 불편`, category: "cafe_focus", source_ref: cafeId, frequency,
      }));
      const created = await saveDiscoveries(suggestions);
      return NextResponse.json({ created: created.length, suggestions });
    }

    if (body.action === "cafe-to-industry") {
      const cafeId = normalizeTerm(body.cafeId);
      if (!cafeId) return NextResponse.json({ error: "카페 ID가 필요합니다." }, { status: 400 });
      const cached = await supabaseRest(`cafe_names?cafe_id=eq.${encodeURIComponent(cafeId)}&select=cafe_name&limit=1`) as Row[] | null;
      const cafeName = normalizeTerm(cached?.[0]?.cafe_name) || cafeId;
      await supabaseRest("industry_seeds?on_conflict=ksic_code", {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify({ ksic_code: `CAFE:${cafeId}`, ksic_name: cafeName, section: "CUSTOM", active: true, note: "카페 역채굴 입력", done: false }),
      });
      return NextResponse.json({ added: true });
    }

    if (body.action === "mine-text") {
      const rows = await supabaseRest("raw_items?status=in.(llm1_passed,analyzed)&select=id,title,body&order=collected_at.desc&limit=200") as Row[] | null;
      const corpusRows = (rows ?? []).slice(0, 100).map(row => ({ id: String(row.id), title: String(row.title ?? "").slice(0, 200), body: String(row.body ?? "").slice(0, 900) }));
      if (!corpusRows.length) return NextResponse.json({ created: 0, reason: "통과 원문이 없습니다." });
      const llm = getLlmProvider();
      const completion = await llm.complete({
        model: resolveLlmModel(undefined, "stage1"), jsonMode: true, maxOutputTokens: 2400,
        system: "너는 실무자가 원문에서 실제로 쓴 어휘만 뽑는 엄격한 용어 추출기다. 추측하거나 일반화하지 말고 유효한 JSON 객체만 응답하라.",
        user: `다음 1차 통과 원문의 title과 body에서 실제로 등장한 표현만 추출하라. tools는 도구·프로그램·서비스명, tasks는 업무·작업 명사, jargon은 해당 직군 특유 표현이다. 분류명을 새로 만들거나 검색어를 조합하지 말고 원문 표기를 보존하라. {"tools":[""],"tasks":[""],"jargon":[""]} 형식으로 중복 없이 응답하라.\n${JSON.stringify(corpusRows)}`,
      });
      const parsed = JSON.parse(completion.text) as Record<string, unknown>;
      const corpus = corpusRows.map(row => `${row.title} ${row.body}`).join("\n").toLocaleLowerCase("ko-KR");
      const candidates: DiscoveryInput[] = [];
      for (const category of ["tools", "tasks", "jargon"] as const) {
        for (const rawTerm of Array.isArray(parsed[category]) ? parsed[category] as unknown[] : []) {
          const term = normalizeTerm(rawTerm);
          if (!term) continue;
          const frequency = corpus.split(term.toLocaleLowerCase("ko-KR")).length - 1;
          if (frequency > 0) candidates.push({ origin: "text_mining", term, category, source_ref: "llm_pass_batch", frequency });
        }
      }
      const created = await saveDiscoveries(candidates);
      return NextResponse.json({ created: created.length, calls: 1, inputTokens: completion.inputTokens, outputTokens: completion.outputTokens });
    }

    if (body.action === "translate-industries") {
      const industryIds = [...new Set((body.industryIds ?? []).map(Number).filter(Number.isFinite))].slice(0, 20);
      if (!industryIds.length) return NextResponse.json({ error: "번역할 업종을 선택해 주세요." }, { status: 400 });
      const selectedRows = await supabaseRest(`industry_seeds?id=in.(${industryIds.join(",")})&active=eq.true&done=eq.false&select=id,ksic_code,ksic_name,section`) as Row[] | null;
      const rowById = new Map((selectedRows ?? []).map(row => [Number(row.id), row]));
      const rows = industryIds.map(id => rowById.get(id)).filter((row): row is Row => Boolean(row));
      const llm = getLlmProvider();
      let calls = 0;
      let created = 0;
      for (const row of rows) {
        const completion = await llm.complete({
          model: resolveLlmModel(undefined, "stage1"), jsonMode: true, maxOutputTokens: 1200,
          system: "너는 한국 현업 커뮤니티의 실제 어휘를 제안하는 산업 용어 번역기다. 소프트웨어로 해결 가능한 정보·관리 업무만 다루고 유효한 JSON 객체만 응답하라.",
          user: `"${String(row.ksic_name)}"에 종사하는 사람들이 네이버 카페나 커뮤니티에서 자기 일을 이야기할 때 실제로 쓰는 표현을 뽑아라. 분류상의 공식 명칭이 아니라 당사자들이 쓰는 말이어야 한다.

중요 제약:
- 소프트웨어·앱·웹으로 해결될 수 있는 정보·관리·사무·거래·고객 관련 업무만 포함하라.
- 물리적 작업 동사(자르다, 뜨다, 포장하다, 운반하다, 세척하다 등), 손으로 하는 육체 노동, 장비·기계 명칭은 제외하라.
- 관리·기록·정산·예약·고객응대·일정·문서·재고·매출 등 반복되면 도구가 필요해지는 업무에 집중하라.
- tools에는 소프트웨어·플랫폼·서비스명만 넣고 물리 장비는 절대 넣지 마라.

{"roles":["직군 호칭"],"tools":["소프트웨어·플랫폼·서비스명"],"tasks":["관리·사무·거래 성격의 반복 업무"]} 형식으로 응답하라.`,
        });
        calls++;
        const parsed = sanitizeIndustryTranslation(JSON.parse(completion.text) as Record<string, unknown>);
        const inputs: DiscoveryInput[] = [];
        for (const category of ["roles", "tools", "tasks"] as const) for (const rawTerm of Array.isArray(parsed[category]) ? parsed[category] as unknown[] : []) {
          const term = normalizeTerm(rawTerm);
          if (term && (category === "roles" || isSoftwareRelevantVocabulary(term))) inputs.push({ origin: "industry", term, category, source_ref: String(row.id), frequency: category === "roles" ? 1 : 2 });
        }
        created += (await saveDiscoveries(inputs)).length;
        await supabaseRest(`industry_seeds?id=eq.${encodeURIComponent(String(row.id))}`, { method: "PATCH", body: JSON.stringify({ done: true, translation: parsed, translated_at: new Date().toISOString() }) });
      }
      return NextResponse.json({ translated: rows.length, calls, created });
    }

    return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "검색어 발굴 작업에 실패했습니다." }, { status: 500 });
  }
}
