import { AUTO_RUN_LIMITS, MANUAL_RUN_LIMITS } from "./limits";
import { supabaseRest, type RunConfig } from "./pipeline";

type SeedRow = { query_text: string; origin?: string };

function uniqueQueries(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

export async function resolveManualQueries(config: RunConfig) {
  const requested = uniqueQueries(config.queries ?? config.domains ?? []);
  if (!requested.length) {
    const rows = await supabaseRest(
      `seed_queries?active=eq.true&select=query_text,origin&order=last_used_at.asc.nullsfirst,id.asc&limit=${MANUAL_RUN_LIMITS.MAX_QUERIES}`,
    ) as SeedRow[] | null;
    const executed = (rows ?? []).map(row => row.query_text);
    return { requested: executed, executed, origins: Object.fromEntries((rows ?? []).map(row => [row.query_text, row.origin ?? "manual"])) };
  }

  const existing = await supabaseRest("seed_queries?select=query_text,origin&limit=5000") as SeedRow[] | null;
  const known = new Set((existing ?? []).map(row => row.query_text.toLocaleLowerCase("ko-KR")));
  const originByQuery = new Map((existing ?? []).map(row => [row.query_text.toLocaleLowerCase("ko-KR"), row.origin ?? "manual"]));
  const manual = requested
    .filter(query => !known.has(query.toLocaleLowerCase("ko-KR")))
    .map(query_text => ({ family: "question", query_text, domain: "manual", active: true, origin: "manual" }));
  if (manual.length) await supabaseRest("seed_queries", { method: "POST", body: JSON.stringify(manual) });

  return {
    requested,
    executed: requested.slice(0, MANUAL_RUN_LIMITS.MAX_QUERIES),
    origins: Object.fromEntries(requested.map(query => [query, originByQuery.get(query.toLocaleLowerCase("ko-KR")) ?? "manual"])),
  };
}

export async function resolveAutomaticQueries() {
  const rows = await supabaseRest(
    `seed_queries?active=eq.true&select=query_text,origin&order=last_used_at.asc.nullsfirst,id.asc&limit=${AUTO_RUN_LIMITS.MAX_QUERIES}`,
  ) as SeedRow[] | null;
  return {
    queries: (rows ?? []).map(row => row.query_text),
    origins: Object.fromEntries((rows ?? []).map(row => [row.query_text, row.origin ?? "manual"])),
  };
}

export async function markQueriesUsed(queries: string[]) {
  const last_used_at = new Date().toISOString();
  await Promise.all(queries.map(query => supabaseRest(
    `seed_queries?query_text=eq.${encodeURIComponent(query)}`,
    { method: "PATCH", body: JSON.stringify({ last_used_at }) },
  )));
}
