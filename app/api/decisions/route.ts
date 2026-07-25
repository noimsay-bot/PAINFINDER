import { NextResponse } from "next/server";
import { isRejectionReasonCategory, REJECTION_REASON_LABELS, type LearningSuggestionType } from "@/lib/learning";
import { supabaseRest } from "@/lib/pipeline";
import { extractRuleSuggestionTerms } from "@/lib/rule-filter";
import { extractPromotionalProductNames } from "@/lib/promotional";

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

export async function POST(request: Request) {
  try {
    const body = await request.json() as { painPointId?: string; action?: string; reasonCategory?: string; reasonNote?: string };
    if (!body.painPointId || !["tracking", "holding", "rejected", "unreviewed"].includes(body.action ?? "")) return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
    if (body.action === "rejected" && !isRejectionReasonCategory(body.reasonCategory)) return NextResponse.json({ error: "기각 사유를 선택해 주세요." }, { status: 400 });
    const reasonCategory = body.action === "rejected" && isRejectionReasonCategory(body.reasonCategory) ? body.reasonCategory : null;
    const reasonNote = body.action === "rejected" ? String(body.reasonNote ?? "").trim().slice(0, 500) : null;
    if (reasonCategory === "other" && !reasonNote) return NextResponse.json({ error: "기타 사유를 입력해 주세요." }, { status: 400 });
    const reason = reasonCategory ? `${REJECTION_REASON_LABELS[reasonCategory]}${reasonNote ? ` · ${reasonNote}` : ""}` : null;
    const saved = await supabaseRest("decisions", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ pain_point_id: body.painPointId, action: body.action, reason, reason_category: reasonCategory, reason_note: reasonNote }),
    });

    if (body.action === "rejected" && reasonCategory) {
      const rows = await supabaseRest(`pain_points?id=eq.${encodeURIComponent(body.painPointId)}&select=id,pain_summary,domain,raw_items(title,body)&limit=1`) as Row[] | null;
      const pain = rows?.[0] ?? {};
      const raw = one(pain.raw_items);
      if (reasonCategory === "not_pain") {
        const text = `${reasonNote ?? ""} ${String(raw.title ?? "")} ${String(raw.body ?? "")} ${String(pain.pain_summary ?? "")}`;
        for (const term of extractRuleSuggestionTerms(text)) await addLearningSuggestion("keyword", term, body.painPointId);
      }
      if (reasonCategory === "promotional") {
        const text = `${String(raw.title ?? "")} ${String(raw.body ?? "")}`;
        for (const productName of extractPromotionalProductNames(text)) {
          await addLearningSuggestion("promotional_keyword", productName, body.painPointId);
        }
      }
      if (reasonCategory === "out_of_scope") await addLearningSuggestion("domain", String(pain.domain ?? ""), body.painPointId);
      if (reasonCategory === "inaccurate_summary") {
        await addLearningSuggestion("prompt_example", `${String(pain.domain ?? "미분류")} | ${String(pain.pain_summary ?? "")}`, body.painPointId);
      }
    }
    return NextResponse.json(saved ?? { ...body, mode: "demo" });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 }); }
}
