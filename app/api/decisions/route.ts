import { NextResponse } from "next/server";
import { normalizeRejectionReasonCategory, REJECTION_REASON_LABELS, type LearningSuggestionType } from "@/lib/learning";
import { supabaseRest } from "@/lib/pipeline";
import { extractSafeAutoExclusionTerms, isSafeAutoExclusionTerm } from "@/lib/rule-filter";
import { extractPromotionalExclusionTerms } from "@/lib/promotional";
import { addActiveFilter } from "@/lib/filter-additions";

type Row = Record<string, unknown>;

function one(value: unknown): Row {
  if (Array.isArray(value)) return (value[0] as Row | undefined) ?? {};
  return (value as Row | null) ?? {};
}

async function addLearningSuggestion(type: LearningSuggestionType, value: string, painPointId: string) {
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 240);
  if (!normalized) return;
  const rows = await supabaseRest(`learning_suggestions?suggestion_type=eq.${encodeURIComponent(type)}&value=eq.${encodeURIComponent(normalized)}&select=id,evidence_count&limit=1`) as Row[] | null;
  const existing = rows?.[0];
  if (existing) {
    await supabaseRest(`learning_suggestions?id=eq.${encodeURIComponent(String(existing.id))}`, {
      method: "PATCH",
      body: JSON.stringify({ evidence_count: Number(existing.evidence_count ?? 1) + 1 }),
    });
    return;
  }
  await supabaseRest("learning_suggestions", {
    method: "POST",
    body: JSON.stringify({ suggestion_type: type, value: normalized, source_pain_point_id: painPointId, evidence_count: 1, status: "pending" }),
  });
}

async function applyRejectionLearning(reasonCategory: NonNullable<ReturnType<typeof normalizeRejectionReasonCategory>>, reasonNote: string | null, painPointId: string, pain: Row, raw: Row) {
  if (reasonCategory === "not_painpoint") {
    const text = `${reasonNote ?? ""} ${String(raw.title ?? "")} ${String(raw.body ?? "")} ${String(pain.pain_summary ?? "")}`;
    const results = await Promise.all(extractSafeAutoExclusionTerms(text).map(term =>
      addActiveFilter({ keyword: term, kind: "keyword", sourceReason: reasonCategory, mode: "auto", originPainPointId: painPointId })
    ));
    return results.filter(Boolean).length;
  }
  if (reasonCategory === "promotional") {
    const text = `${String(raw.title ?? "")} ${String(raw.body ?? "")}`;
    const results = await Promise.all(extractPromotionalExclusionTerms(text).filter(isSafeAutoExclusionTerm).map(term =>
      addActiveFilter({ keyword: term, kind: "keyword", sourceReason: reasonCategory, mode: "auto", originPainPointId: painPointId })
    ));
    return results.filter(Boolean).length;
  }
  if (reasonCategory === "out_of_interest") await addLearningSuggestion("domain", String(pain.domain ?? ""), painPointId);
  if (reasonCategory === "inaccurate_summary") {
    await addLearningSuggestion("prompt_example", `${String(pain.domain ?? "미분류")} | ${String(pain.pain_summary ?? "")}`, painPointId);
  }
  return 0;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { painPointId?: string; action?: string; reasonCategory?: string; reasonNote?: string; domain?: string };
    if (body.action === "hold_domain") {
      const domain = String(body.domain ?? "").trim().slice(0, 120);
      if (!domain) return NextResponse.json({ error: "보류할 분야가 없습니다." }, { status: 400 });
      const rows = await supabaseRest(
        `pain_points?domain=eq.${encodeURIComponent(domain)}&select=id,raw_item_id,decisions(action,decided_at)&limit=500`,
      ) as Row[] | null;
      const targets = (rows ?? []).filter(row => {
        const decisions = Array.isArray(row.decisions) ? [...row.decisions] as Row[] : [];
        decisions.sort((a, b) => String(b.decided_at ?? "").localeCompare(String(a.decided_at ?? "")));
        return String(decisions[0]?.action ?? "unreviewed") === "unreviewed";
      });
      if (!targets.length) return NextResponse.json({ heldCount: 0, domain });
      const decidedAt = new Date().toISOString();
      await supabaseRest("decisions", {
        method: "POST",
        body: JSON.stringify(targets.map(row => ({
          pain_point_id: row.id,
          action: "holding",
          reason: `사용자 선택 · ${domain} 분야 전체 보류`,
          reason_note: `${domain} 분야 전체 보류`,
          decided_at: decidedAt,
        }))),
      });
      const rawIds = targets.map(row => String(row.raw_item_id ?? "")).filter(Boolean);
      if (rawIds.length) {
        await supabaseRest(`raw_items?id=in.(${rawIds.join(",")})`, {
          method: "PATCH",
          body: JSON.stringify({ status: "analyzed" }),
        });
      }
      return NextResponse.json({ heldCount: targets.length, domain });
    }
    if (!body.painPointId || !["tracking", "holding", "rejected", "unreviewed"].includes(body.action ?? "")) return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
    const normalizedCategory = normalizeRejectionReasonCategory(body.reasonCategory);
    if (body.action === "rejected" && !normalizedCategory) return NextResponse.json({ error: "기각 사유를 선택해 주세요." }, { status: 400 });
    const reasonCategory = body.action === "rejected" ? normalizedCategory : null;
    const reasonNote = body.action === "rejected" ? String(body.reasonNote ?? "").trim().slice(0, 500) : null;
    if (reasonCategory === "other" && !reasonNote) return NextResponse.json({ error: "기타 사유를 입력해 주세요." }, { status: 400 });
    const reason = reasonCategory ? `${REJECTION_REASON_LABELS[reasonCategory]}${reasonNote ? ` · ${reasonNote}` : ""}` : null;
    const [painRows, saved] = await Promise.all([
      supabaseRest(`pain_points?id=eq.${encodeURIComponent(body.painPointId)}&select=id,raw_item_id,pain_summary,domain,raw_items(id,title,body)&limit=1`) as Promise<Row[] | null>,
      supabaseRest("decisions", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ pain_point_id: body.painPointId, action: body.action, reason, reason_category: reasonCategory, reason_note: reasonNote }),
      }),
    ]);
    const pain = painRows?.[0] ?? {};
    const raw = one(pain.raw_items);

    const rawItemId = String(pain.raw_item_id ?? raw.id ?? "");
    const followUpTasks: Promise<unknown>[] = [];
    if (rawItemId) {
      followUpTasks.push(supabaseRest(`raw_items?id=eq.${encodeURIComponent(rawItemId)}`, {
        method: "PATCH",
        body: JSON.stringify(body.action === "unreviewed"
          ? {
              status: "analyzed",
              review_status: "eligible",
              review_status_reason: null,
              review_override: true,
              review_status_updated_at: new Date().toISOString(),
            }
          : { status: body.action === "rejected" ? "rejected_by_user" : "analyzed" }),
      }));
    }

    let learningTask: Promise<number> | null = null;
    if (body.action === "rejected" && reasonCategory) {
      learningTask = applyRejectionLearning(reasonCategory, reasonNote, body.painPointId, pain, raw);
      followUpTasks.push(learningTask);
    }
    await Promise.all(followUpTasks);
    const automaticFilterCount = learningTask ? await learningTask : 0;
    return NextResponse.json({ saved: saved ?? { ...body, mode: "demo" }, automaticFilterCount });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 }); }
}
