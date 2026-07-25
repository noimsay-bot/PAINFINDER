import { NextResponse } from "next/server";
import { MANUAL_RUN_LIMITS, RUN_TIME_BUDGET } from "@/lib/limits";
import { persistRun, runPipeline, supabaseRest } from "@/lib/pipeline";
import {
  buildWatchedCafeQueries,
  inferWatchedCafeTopicSeeds,
  normalizeTopicSeeds,
  parseNaverCafeId,
  type WatchedCafe,
} from "@/lib/watched-cafes";
import { fetchNaverCafeName, isUsableCafeName } from "@/lib/cafe-names";

export const runtime = "nodejs";
export const maxDuration = 300;

type Row = Record<string, unknown>;

function one(value: unknown): Row {
  if (Array.isArray(value)) return (value[0] as Row | undefined) ?? {};
  return (value as Row | null) ?? {};
}

function normalizeCafeId(value: unknown) {
  const cafeId = String(value ?? "").trim();
  return /^[A-Za-z0-9_-]{2,80}$/.test(cafeId) ? cafeId : "";
}

async function watchedCafePayload() {
  const [cafes, rawRows] = await Promise.all([
    supabaseRest("watched_cafes?select=id,cafe_id,cafe_name,topic_seeds,active,origin,created_at,updated_at&order=created_at.asc") as Promise<Row[] | null>,
    supabaseRest("raw_items?source=eq.cafearticle&select=id,url,status,pain_points(id,decisions(action,decided_at))&order=collected_at.desc&limit=10000") as Promise<Row[] | null>,
  ]);
  const rawCafeIds = new Map((rawRows ?? []).map(raw => [String(raw.id), parseNaverCafeId(raw.url)?.toLocaleLowerCase("ko-KR") ?? ""]));
  return (cafes ?? []).map(cafe => {
    const cafeId = String(cafe.cafe_id);
    const relevant = (rawRows ?? []).filter(raw => rawCafeIds.get(String(raw.id)) === cafeId.toLocaleLowerCase("ko-KR"));
    let tracked = 0;
    for (const raw of relevant) {
      const pain = one(raw.pain_points);
      const decisions = Array.isArray(pain.decisions) ? [...pain.decisions] as Row[] : [];
      decisions.sort((a, b) => String(b.decided_at ?? "").localeCompare(String(a.decided_at ?? "")));
      if (String(decisions[0]?.action ?? "") === "tracking") tracked++;
    }
    const passed = relevant.filter(raw => ["llm1_passed", "analyzed"].includes(String(raw.status))).length;
    return {
      id: Number(cafe.id),
      cafeId: String(cafe.cafe_id),
      cafeName: String(cafe.cafe_name),
      topicSeeds: normalizeTopicSeeds(cafe.topic_seeds),
      active: Boolean(cafe.active),
      origin: String(cafe.origin ?? "manual"),
      createdAt: String(cafe.created_at ?? ""),
      collected: relevant.length,
      passed,
      tracked,
      trackingRate: relevant.length ? tracked / relevant.length : 0,
    };
  });
}

async function inferCafeSeeds(cafeId: string, fallbackDomain: unknown) {
  const rows = await supabaseRest(
    "raw_items?source=eq.cafearticle&select=url,pain_points(domain,pain_summary)&order=collected_at.desc&limit=5000",
  ) as Row[] | null;
  const signals = (rows ?? [])
    .filter(row => parseNaverCafeId(row.url)?.toLocaleLowerCase("ko-KR") === cafeId.toLocaleLowerCase("ko-KR"))
    .map(row => {
      const pain = one(row.pain_points);
      return { domain: pain.domain, painSummary: pain.pain_summary };
    });
  return inferWatchedCafeTopicSeeds(signals, fallbackDomain);
}

async function resolveCafeName(cafeId: string, sourceName: unknown) {
  const source = String(sourceName ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const cachedRows = await supabaseRest(
    `cafe_names?cafe_id=eq.${encodeURIComponent(cafeId)}&select=cafe_name&limit=1`,
  ) as Row[] | null;
  const cached = String(cachedRows?.[0]?.cafe_name ?? "");
  if (isUsableCafeName(source, cafeId)) return source;
  if (isUsableCafeName(cached, cafeId)) return cached;
  const { cafeName, fetchError } = await fetchNaverCafeName(cafeId);
  await supabaseRest("cafe_names?on_conflict=cafe_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      cafe_id: cafeId,
      cafe_name: cafeName,
      fetched_at: new Date().toISOString(),
      fetch_error: fetchError,
    }),
  });
  return cafeName ?? cafeId;
}

export async function GET() {
  try {
    return NextResponse.json({ watchedCafes: await watchedCafePayload() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "주목 카페를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const body = await request.json() as {
      action?: string;
      id?: number;
      painPointId?: string;
      cafeId?: string;
      cafeName?: string;
      topicSeeds?: unknown;
      active?: boolean;
    };
    if (body.action === "quick_toggle") {
      const painPointId = String(body.painPointId ?? "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(painPointId)) {
        return NextResponse.json({ error: "후보 ID가 필요합니다." }, { status: 400 });
      }
      const painRows = await supabaseRest(
        `pain_points?id=eq.${encodeURIComponent(painPointId)}&select=id,domain,pain_summary,raw_items(id,source,url,source_name)&limit=1`,
      ) as Row[] | null;
      const pain = painRows?.[0];
      const raw = one(pain?.raw_items);
      if (!pain || String(raw.source) !== "cafearticle") {
        return NextResponse.json({ error: "네이버 카페 후보에서만 주목할 수 있습니다." }, { status: 400 });
      }
      const cafeId = normalizeCafeId(parseNaverCafeId(raw.url));
      if (!cafeId) return NextResponse.json({ error: "원문 URL에서 카페 ID를 찾지 못했습니다." }, { status: 400 });

      const existingRows = await supabaseRest(
        `watched_cafes?cafe_id=eq.${encodeURIComponent(cafeId)}&select=id,cafe_id,cafe_name,topic_seeds,active,origin&limit=1`,
      ) as Row[] | null;
      const existing = existingRows?.[0];
      if (existing?.active) {
        await supabaseRest(`watched_cafes?id=eq.${Number(existing.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
        });
        return NextResponse.json({
          updated: true,
          active: false,
          cafeId,
          cafeName: String(existing.cafe_name ?? cafeId),
          topicSeeds: normalizeTopicSeeds(existing.topic_seeds),
        });
      }

      const topicSeeds = normalizeTopicSeeds(existing?.topic_seeds);
      const nextSeeds = topicSeeds.length ? topicSeeds : await inferCafeSeeds(cafeId, pain.domain);
      const currentName = String(existing?.cafe_name ?? "");
      const cafeName = isUsableCafeName(currentName, cafeId)
        ? currentName
        : await resolveCafeName(cafeId, raw.source_name);
      const saved = await supabaseRest("watched_cafes?on_conflict=cafe_id&select=id,cafe_id,cafe_name,topic_seeds,active,origin", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          cafe_id: cafeId,
          cafe_name: cafeName,
          topic_seeds: nextSeeds,
          active: true,
          origin: existing?.origin ?? "candidate",
          updated_at: new Date().toISOString(),
        }),
      }) as Row[] | null;
      return NextResponse.json({
        saved: !existing,
        updated: Boolean(existing),
        active: true,
        cafeId,
        cafeName,
        topicSeeds: nextSeeds,
        id: saved?.[0]?.id ?? existing?.id ?? null,
      });
    }

    if (body.action === "save") {
      const cafeId = normalizeCafeId(body.cafeId);
      const cafeName = String(body.cafeName ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      const topicSeeds = normalizeTopicSeeds(body.topicSeeds);
      if (!cafeId || !cafeName || !topicSeeds.length) {
        return NextResponse.json({ error: "카페 ID·카페명·주제어를 모두 입력해 주세요." }, { status: 400 });
      }
      const saved = await supabaseRest("watched_cafes?on_conflict=cafe_id&select=id,cafe_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          cafe_id: cafeId,
          cafe_name: cafeName,
          topic_seeds: topicSeeds,
          active: body.active ?? true,
          updated_at: new Date().toISOString(),
        }),
      }) as Row[] | null;
      return NextResponse.json({ saved: true, id: saved?.[0]?.id ?? null });
    }

    if (body.action === "toggle") {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return NextResponse.json({ error: "주목 카페 ID가 필요합니다." }, { status: 400 });
      await supabaseRest(`watched_cafes?id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: Boolean(body.active), updated_at: new Date().toISOString() }),
      });
      return NextResponse.json({ updated: true });
    }

    if (body.action === "delete") {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return NextResponse.json({ error: "주목 카페 ID가 필요합니다." }, { status: 400 });
      await supabaseRest(`watched_cafes?id=eq.${id}`, { method: "DELETE" });
      return NextResponse.json({ deleted: true });
    }

    if (body.action === "focus") {
      const cafeId = normalizeCafeId(body.cafeId);
      if (!cafeId) return NextResponse.json({ error: "카페 ID가 필요합니다." }, { status: 400 });
      const rows = await supabaseRest(`watched_cafes?cafe_id=eq.${encodeURIComponent(cafeId)}&active=eq.true&select=id,cafe_id,cafe_name,topic_seeds,active&limit=1`) as WatchedCafe[] | null;
      const cafe = rows?.[0];
      if (!cafe) return NextResponse.json({ error: "활성 주목 카페로 먼저 등록해 주세요." }, { status: 400 });
      cafe.topic_seeds = normalizeTopicSeeds(cafe.topic_seeds);
      const targeted = buildWatchedCafeQueries([cafe], 4);
      if (!targeted.length) return NextResponse.json({ error: "집중 수집에 쓸 주제어가 없습니다." }, { status: 400 });
      const queries = targeted.map(item => item.query);
      const origins = Object.fromEntries(targeted.map(item => [item.query, `watched_cafe:${cafe.cafe_id}`]));
      const result = await runPipeline({
        name: `${cafe.cafe_name} 집중 수집`,
        queries,
        query_origins: origins,
        sources: { naverCafe: true },
        source_weights: { cafearticle: 100, kin: 0, blog: 0, webkr: 0 },
        auto_verify_top_n: MANUAL_RUN_LIMITS.AUTO_VERIFY_TOP_N,
        limits: {
          queries: 4,
          itemsPerSource: MANUAL_RUN_LIMITS.ITEMS_PER_SOURCE,
          dailyCostUsd: 3,
        },
      }, {
        deadlineAt: startedAt + RUN_TIME_BUDGET.DEADLINE_MS,
        llm1MaxCalls: MANUAL_RUN_LIMITS.LLM1_MAX_CALLS,
        llm2MaxCalls: MANUAL_RUN_LIMITS.LLM2_MAX_CALLS,
      });
      const persisted = await persistRun(result);
      return NextResponse.json({
        ...persisted,
        stageCounts: result.stageCounts,
        queries: result.queries,
        costEstimate: result.costEstimate,
        stoppedReason: result.stoppedReason,
        errors: result.errors,
      });
    }

    return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "주목 카페 작업에 실패했습니다." }, { status: 500 });
  }
}
