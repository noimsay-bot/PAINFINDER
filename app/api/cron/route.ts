import { NextResponse } from "next/server";
import { persistRun, runPipeline, supabaseRest, type RunConfig } from "@/lib/pipeline";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const configs = await supabaseRest("run_configs?is_default=eq.true&limit=1") as RunConfig[] | null;
  const result = await runPipeline(configs?.[0] ?? {});
  const runId = await persistRun(result).catch(() => null);
  return NextResponse.json({ runId, stageCounts: result.stageCounts, costEstimate: result.costEstimate, stoppedReason: result.stoppedReason, errors: result.errors });
}
