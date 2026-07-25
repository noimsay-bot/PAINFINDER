import { NextResponse } from "next/server";
import { LEARNING_MIN_EVIDENCE, REJECTION_REASON_LABELS, type RejectionReasonCategory } from "@/lib/learning";
import { supabaseRest } from "@/lib/pipeline";

type Row = Record<string, unknown>;

function one(value: unknown): Row {
  if (Array.isArray(value)) return (value[0] as Row | undefined) ?? {};
  return (value as Row | null) ?? {};
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko-KR"));
}

export async function GET() {
  try {
    const [suggestions, exclusions, decisionRows, painRows] = await Promise.all([
      supabaseRest("learning_suggestions?select=id,suggestion_type,value,evidence_count,status,created_at,source_pain_point_id&order=evidence_count.desc,created_at.desc&limit=500") as Promise<Row[] | null>,
      supabaseRest("rule_exclusions?select=id,kind,value,source,active,created_at&order=created_at.desc&limit=500") as Promise<Row[] | null>,
      supabaseRest("decisions?select=id,pain_point_id,action,reason_category,reason_note,decided_at&order=decided_at.desc&limit=5000") as Promise<Row[] | null>,
      supabaseRest("pain_points?select=id,domain,scores(total,verdict),raw_items(query_origin)&limit=5000") as Promise<Row[] | null>,
    ]);

    const latestByPain = new Map<string, Row>();
    for (const decision of decisionRows ?? []) {
      const painPointId = String(decision.pain_point_id ?? "");
      if (painPointId && !latestByPain.has(painPointId)) latestByPain.set(painPointId, decision);
    }
    const decisions = [...latestByPain.values()];
    const decisionCounts = Object.fromEntries(["tracking", "holding", "rejected"].map(action => [action, decisions.filter(row => row.action === action).length]));
    const reasonDistribution = countBy(decisions
      .filter(row => row.action === "rejected")
      .map(row => {
        const category = String(row.reason_category ?? "") as RejectionReasonCategory;
        return REJECTION_REASON_LABELS[category] ?? "미분류";
      }));

    const painById = new Map((painRows ?? []).map(row => [String(row.id), row]));
    const originMap = new Map<string, { origin: string; decided: number; tracking: number }>();
    for (const decision of decisions) {
      const pain = painById.get(String(decision.pain_point_id ?? ""));
      if (!pain) continue;
      const raw = one(pain.raw_items);
      const rawOrigin = String(raw.query_origin ?? "unknown");
      const origin = ["manual", "cafe", "text_mining", "industry"].includes(rawOrigin) ? rawOrigin : "unknown";
      const item = originMap.get(origin) ?? { origin, decided: 0, tracking: 0 };
      item.decided++;
      if (decision.action === "tracking") item.tracking++;
      originMap.set(origin, item);
    }
    const originStats = [...originMap.values()].map(item => ({ ...item, trackingRate: item.decided ? item.tracking / item.decided : 0 })).sort((a, b) => b.trackingRate - a.trackingRate || b.decided - a.decided);

    const trackedPains = decisions.filter(row => row.action === "tracking").map(row => painById.get(String(row.pain_point_id ?? ""))).filter((row): row is Row => Boolean(row));
    const domainStats = countBy(trackedPains.map(row => String(row.domain ?? "미분류")));
    const verdictStats = countBy(trackedPains.map(row => String(one(row.scores).verdict ?? "unverified")));
    const scoreBandStats = countBy(trackedPains.map(row => {
      const score = Number(one(row.scores).total ?? 0);
      return score >= 8 ? "8점 이상" : score >= 5 ? "5~7점" : "4점 이하";
    }));

    return NextResponse.json({
      minEvidence: LEARNING_MIN_EVIDENCE,
      suggestions: suggestions ?? [],
      exclusions: exclusions ?? [],
      stats: {
        decisionCounts,
        reasonDistribution,
        originStats,
        trackingProfile: {
          topDomain: domainStats[0] ?? null,
          topVerdict: verdictStats[0] ?? null,
          topScoreBand: scoreBandStats[0] ?? null,
        },
        promptExampleCount: (suggestions ?? []).filter(row => row.suggestion_type === "prompt_example").length,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "학습 통계를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; ids?: number[] };
    if (body.action !== "approve") return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
    const ids = [...new Set((body.ids ?? []).map(Number).filter(Number.isFinite))].slice(0, 100);
    if (!ids.length) return NextResponse.json({ approved: 0 });
    const rows = await supabaseRest(`learning_suggestions?id=in.(${ids.join(",")})&status=eq.pending&evidence_count=gte.${LEARNING_MIN_EVIDENCE}&suggestion_type=in.(keyword,promotional_keyword,domain)&select=id,suggestion_type,value`) as Row[] | null;
    const approvedRows = rows ?? [];
    if (approvedRows.length) {
      await supabaseRest("rule_exclusions?on_conflict=kind,value", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(approvedRows.map(row => ({
          kind: row.suggestion_type === "promotional_keyword" ? "keyword" : row.suggestion_type,
          value: String(row.value),
          source: "decision_learning",
          active: true,
        }))),
      });
      await supabaseRest(`learning_suggestions?id=in.(${approvedRows.map(row => Number(row.id)).join(",")})`, {
        method: "PATCH",
        body: JSON.stringify({ status: "approved", reviewed_at: new Date().toISOString() }),
      });
    }
    return NextResponse.json({ approved: approvedRows.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "학습 제안 승인에 실패했습니다." }, { status: 500 });
  }
}
