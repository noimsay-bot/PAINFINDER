import { NextResponse } from "next/server";
import { persistRun, runPipeline, supabaseRest, type RunConfig } from "@/lib/pipeline";
import { AUTO_RUN_LIMITS, RUN_TIME_BUDGET } from "@/lib/limits";
import { markQueriesUsed, resolveAutomaticQueries } from "@/lib/run-execution";

export const maxDuration = 300;

export async function GET(request: Request) {
  const requestStartedAt = Date.now();
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const configs = await supabaseRest("run_configs?is_default=eq.true&limit=1") as RunConfig[] | null;
  const resolved = await resolveAutomaticQueries();
  const base = configs?.[0] ?? {};
  const result = await runPipeline({
    ...base,
    queries: resolved.queries,
    query_origins: resolved.origins,
    auto_verify_top_n: Math.min(base.auto_verify_top_n ?? AUTO_RUN_LIMITS.AUTO_VERIFY_TOP_N, AUTO_RUN_LIMITS.AUTO_VERIFY_TOP_N),
    limits: {
      ...base.limits,
      queries: AUTO_RUN_LIMITS.MAX_QUERIES,
      itemsPerSource: Math.min(base.limits?.itemsPerSource ?? AUTO_RUN_LIMITS.ITEMS_PER_SOURCE, AUTO_RUN_LIMITS.ITEMS_PER_SOURCE),
    },
  }, {
    deadlineAt: requestStartedAt + RUN_TIME_BUDGET.DEADLINE_MS,
    llm1MaxCalls: AUTO_RUN_LIMITS.LLM1_MAX_CALLS,
    llm2MaxCalls: AUTO_RUN_LIMITS.LLM2_MAX_CALLS,
  });
  const persisted = await persistRun(result);
  await markQueriesUsed(result.queries);
  return NextResponse.json({ ...persisted, stageCounts: result.stageCounts, costEstimate: result.costEstimate, stoppedReason: result.stoppedReason, errors: result.errors });
}
