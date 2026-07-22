import { NextResponse } from "next/server";
import { normalizeConfig, supabaseRest, type RunConfig } from "@/lib/pipeline";

export async function GET() {
  try { return NextResponse.json(await supabaseRest("run_configs?select=*&order=updated_at.desc") ?? []); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as RunConfig;
    const config = normalizeConfig(input);
    const row = { name: config.name, is_default: false, model_stage1: config.model_stage1, model_stage2: config.model_stage2, model_verify: config.model_verify, mode_ratio: config.mode_ratio, families: config.families, domains: config.queries, excluded_domains: config.excluded_domains, sources: config.sources, period_days: config.period_days, auto_verify_top_n: config.auto_verify_top_n, app_list: config.app_list, limits: config.limits, updated_at: new Date().toISOString() };
    const saved = await supabaseRest(config.id ? `run_configs?id=eq.${encodeURIComponent(config.id)}` : "run_configs", { method: config.id ? "PATCH" : "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
    return NextResponse.json(saved ?? { ...row, mode: "demo" });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 }); }
}
