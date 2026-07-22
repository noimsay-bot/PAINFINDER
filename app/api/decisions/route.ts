import { NextResponse } from "next/server";
import { supabaseRest } from "@/lib/pipeline";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { painPointId?: string; action?: string; reason?: string };
    if (!body.painPointId || !["tracking", "holding", "rejected", "unreviewed"].includes(body.action ?? "")) return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
    const saved = await supabaseRest("decisions", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ pain_point_id: body.painPointId, action: body.action, reason: body.reason ?? null }) });
    return NextResponse.json(saved ?? { ...body, mode: "demo" });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 }); }
}
