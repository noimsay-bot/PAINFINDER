import { NextResponse } from "next/server";
import { persistRun, runPipeline, supabaseRest, type RunConfig } from "@/lib/pipeline";
import { DEFAULT_LIMITS } from "@/lib/limits";

export const runtime = "nodejs";
export const maxDuration = 300;

type SeedRow = { query_text: string };

async function resolveQueries(config: RunConfig) {
  const explicit = [...new Set((config.queries ?? config.domains ?? []).map(value => value.trim()).filter(Boolean))];
  if (explicit.length) {
    const existing = await supabaseRest("seed_queries?select=query_text&limit=5000") as SeedRow[] | null;
    const known = new Set((existing ?? []).map(row => row.query_text.toLocaleLowerCase("ko-KR")));
    const manual = explicit.filter(query => !known.has(query.toLocaleLowerCase("ko-KR"))).map(query_text => ({ family: "question", query_text, domain: "manual", active: true, origin: "manual" }));
    if (manual.length) await supabaseRest("seed_queries", { method: "POST", body: JSON.stringify(manual) });
    return explicit;
  }
  const rows = await supabaseRest(`seed_queries?active=eq.true&select=query_text&order=last_used_at.asc.nullsfirst,id.asc&limit=${DEFAULT_LIMITS.QUERIES_PER_RUN}`) as SeedRow[] | null;
  return (rows ?? []).map(row => row.query_text);
}

async function markQueriesUsed(queries: string[]) {
  const last_used_at = new Date().toISOString();
  await Promise.all(queries.map(query => supabaseRest(`seed_queries?query_text=eq.${encodeURIComponent(query)}`, { method: "PATCH", body: JSON.stringify({ last_used_at }) })));
}

export async function POST(request: Request) {
  try {
    const config = await request.json().catch(() => ({})) as RunConfig;
    const queries = await resolveQueries(config);
    const result = await runPipeline({ ...config, queries, limits: { ...config.limits, queries: Math.min(config.limits?.queries ?? DEFAULT_LIMITS.QUERIES_PER_RUN, DEFAULT_LIMITS.QUERIES_PER_RUN) } });
    await markQueriesUsed(result.queries);
    let runId: string | null = null;
    try { runId = await persistRun(result); } catch (error) { result.errors.push(`persist:${error instanceof Error ? error.message : "failed"}`); }
    return NextResponse.json({ ...result, runId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Pipeline failed" }, { status: 500 });
  }
}
