import { NextResponse } from "next/server";
import { supabaseRest } from "@/lib/pipeline";
import {
  DEFAULT_REVIEW_QUEUE_MIN_SCORE,
  DEFAULT_REVIEW_QUEUE_SIZE,
  reviewStatusFor,
  type ReviewSettings,
} from "@/lib/review-queue";

type Row = Record<string, unknown>;

function one(value: unknown): Row {
  if (Array.isArray(value)) return (value[0] as Row | undefined) ?? {};
  return (value as Row | null) ?? {};
}

function normalizeSettings(input: Partial<ReviewSettings>): ReviewSettings {
  const queueSize = Number(input.queueSize);
  const minScore = Number(input.minScore);
  return {
    queueSize: Math.min(30, Math.max(5, Math.round(Number.isFinite(queueSize) ? queueSize : DEFAULT_REVIEW_QUEUE_SIZE))),
    minScore: Math.min(10, Math.max(0, Math.round(Number.isFinite(minScore) ? minScore : DEFAULT_REVIEW_QUEUE_MIN_SCORE))),
  };
}

async function loadSettings() {
  const rows = await supabaseRest("review_settings?id=eq.1&select=queue_size,min_score&limit=1") as Row[] | null;
  return normalizeSettings({
    queueSize: Number(rows?.[0]?.queue_size ?? DEFAULT_REVIEW_QUEUE_SIZE),
    minScore: Number(rows?.[0]?.min_score ?? DEFAULT_REVIEW_QUEUE_MIN_SCORE),
  });
}

async function patchRawItems(ids: string[], body: Record<string, unknown>) {
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    await supabaseRest(`raw_items?id=in.(${chunk.join(",")})`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }
}

async function syncAutomaticStatuses(minScore: number) {
  const rows = await supabaseRest(
    "pain_points?select=id,raw_items(id,low_confidence,review_override,review_status,review_status_reason),scores(total,verdict)&limit=5000",
  ) as Row[] | null;
  const grouped = new Map<string, string[]>();
  for (const row of rows ?? []) {
    const raw = one(row.raw_items);
    if (Boolean(raw.review_override)) continue;
    const score = one(row.scores);
    const result = reviewStatusFor({
      score: Number(score.total ?? 0),
      marketVerdict: String(score.verdict ?? "unverified") as never,
      lowConfidence: Boolean(raw.low_confidence),
      reviewOverride: false,
    }, minScore);
    const key = `${result.status}:${result.reason ?? ""}`;
    const id = String(raw.id ?? "");
    if (!id) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), id]);
  }
  const updatedAt = new Date().toISOString();
  for (const [key, ids] of grouped) {
    const [status, reason] = key.split(":");
    await patchRawItems(ids, {
      review_status: status,
      review_status_reason: reason || null,
      review_status_updated_at: updatedAt,
    });
  }
  return [...grouped.values()].reduce((sum, ids) => sum + ids.length, 0);
}

export async function GET() {
  try {
    return NextResponse.json(await loadSettings());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "검토 큐 설정을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const settings = normalizeSettings(await request.json() as Partial<ReviewSettings>);
    await supabaseRest("review_settings?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ id: 1, queue_size: settings.queueSize, min_score: settings.minScore, updated_at: new Date().toISOString() }),
    });
    const updatedCandidates = await syncAutomaticStatuses(settings.minScore);
    return NextResponse.json({ ...settings, updatedCandidates });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "검토 큐 설정을 저장하지 못했습니다." }, { status: 500 });
  }
}
