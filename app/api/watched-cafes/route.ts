import { NextResponse } from "next/server";
import { MANUAL_RUN_LIMITS, RUN_TIME_BUDGET } from "@/lib/limits";
import { persistRun, runPipeline, supabaseRest } from "@/lib/pipeline";
import { buildWatchedCafeQueries, normalizeTopicSeeds, type WatchedCafe } from "@/lib/watched-cafes";

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
    supabaseRest("watched_cafes?select=id,cafe_id,cafe_name,topic_seeds,active,created_at,updated_at&order=created_at.asc") as Promise<Row[] | null>,
    supabaseRest("raw_items?watched=eq.true&select=id,watched_cafe_id,status,pain_points(id,decisions(action,decided_at))&order=collected_at.desc&limit=10000") as Promise<Row[] | null>,
  ]);
  return (cafes ?? []).map(cafe => {
    const relevant = (rawRows ?? []).filter(raw => String(raw.watched_cafe_id ?? "") === String(cafe.cafe_id));
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
      createdAt: String(cafe.created_at ?? ""),
      collected: relevant.length,
      passed,
      tracked,
      trackingRate: relevant.length ? tracked / relevant.length : 0,
    };
  });
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
      cafeId?: string;
      cafeName?: string;
      topicSeeds?: unknown;
      active?: boolean;
    };
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

