import { NextResponse } from "next/server";
import { persistRun, runPipeline, type RunConfig } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const config = await request.json().catch(() => ({})) as RunConfig;
    const result = await runPipeline(config);
    let runId: string | null = null;
    try { runId = await persistRun(result); } catch (error) { result.errors.push(`persist:${error instanceof Error ? error.message : "failed"}`); }
    return NextResponse.json({ ...result, runId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Pipeline failed" }, { status: 500 });
  }
}
