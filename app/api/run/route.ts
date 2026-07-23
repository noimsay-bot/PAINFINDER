import { NextResponse } from "next/server";
import { persistRun, runPipeline, type RunConfig } from "@/lib/pipeline";
import { MANUAL_RUN_LIMITS, RUN_TIME_BUDGET } from "@/lib/limits";
import { markQueriesUsed, resolveManualQueries } from "@/lib/run-execution";
import { applyManualRunLimits } from "@/lib/run-policy";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const requestStartedAt = Date.now();
  try {
    const config = await request.json().catch(() => ({})) as RunConfig;
    const resolved = await resolveManualQueries(config);
    const limited = applyManualRunLimits(config, resolved.executed);
    const result = await runPipeline({ ...limited.config, query_origins: resolved.origins }, {
      deadlineAt: requestStartedAt + RUN_TIME_BUDGET.DEADLINE_MS,
      llm1MaxCalls: MANUAL_RUN_LIMITS.LLM1_MAX_CALLS,
      llm2MaxCalls: MANUAL_RUN_LIMITS.LLM2_MAX_CALLS,
    });
    const persisted = await persistRun(result);
    await markQueriesUsed(result.queries);
    return NextResponse.json({
      ...result,
      ...persisted,
      requestedQueryCount: resolved.requested.length,
      executedQueryCount: result.queries.length,
      requestedSourceCount: limited.requestedSourceCount,
      executedSourceCount: limited.executedSourceCount,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Pipeline failed" }, { status: 500 });
  }
}
