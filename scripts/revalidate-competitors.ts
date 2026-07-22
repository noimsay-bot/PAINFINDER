import { calculateLlmCost } from "../lib/llm/pricing";
import { getLlmProvider, resolveLlmModel } from "../lib/llm";
import { scoreMarket, verifyMarket, type VerificationCounts } from "../lib/competitors";
import { supabaseRest } from "../lib/pipeline";

type Row = Record<string, unknown>;
type Score = { f1: number; f2: number; f3: number; f4: number; f5: number; f6: number; total: number; data_access_stable: boolean };

function one(value: unknown): Row {
  if (Array.isArray(value)) return (value[0] as Row | undefined) ?? {};
  return (value as Row | null) ?? {};
}

function scoreOf(row: Row): Score {
  const score = one(row.scores);
  return {
    f1: Number(score.f1 ?? 0), f2: Number(score.f2 ?? 0), f3: Number(score.f3 ?? 0),
    f4: Number(score.f4 ?? 0), f5: Number(score.f5 ?? 0), f6: Number(score.f6 ?? 0),
    total: Number(score.total ?? 0), data_access_stable: Boolean(score.data_access_stable),
  };
}

function distribution(values: number[]) {
  return Object.fromEntries([...new Set(values)].sort((a, b) => a - b).map(value => [String(value), values.filter(item => item === value).length]));
}

const limitArg = process.argv.find(arg => arg.startsWith("--limit="));
const offsetArg = process.argv.find(arg => arg.startsWith("--offset="));
const concurrencyArg = process.argv.find(arg => arg.startsWith("--concurrency="));
const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1])) : 200;
const offset = offsetArg ? Math.max(0, Number(offsetArg.split("=")[1])) : 0;
const concurrency = Math.min(6, Math.max(1, concurrencyArg ? Number(concurrencyArg.split("=")[1]) : 4));
const startedAt = new Date().toISOString();
const rows = await supabaseRest("pain_points?select=id,pain_summary,domain,money_signal,scores(f1,f2,f3,f4,f5,f6,total,data_access_stable,verdict),competitors(name,url,pricing,quality_note,last_updated_signal)&order=created_at.asc&limit=200") as Row[] | null;
if (!rows?.length) throw new Error("재검증할 pain_points가 없습니다.");

const targets = rows.slice(offset, offset + limit);
const before = targets.map(row => scoreOf(row).total);
const maxOld = targets.reduce<{ id: string; summary: string; count: number }>((best, row) => {
  const count = Array.isArray(row.competitors) ? row.competitors.length : 0;
  return count > best.count ? { id: String(row.id), summary: String(row.pain_summary), count } : best;
}, { id: "", summary: "", count: -1 });

const llm = getLlmProvider();
const model = resolveLlmModel(undefined, "stage2");
const counts: VerificationCounts = { urlExcluded: 0, product: 0, content: 0, irrelevant: 0, appProduct: 0 };
const after: number[] = [];
const errors: string[] = [];
let calls = 0;
let inputTokens = 0;
let outputTokens = 0;
let cost = 0;
let updated = 0;
let maxOldAfter: number | null = null;

async function processRow(row: Row, index: number) {
  const score = scoreOf(row);
  try {
    const summary = String(row.pain_summary ?? "").trim();
    const domain = String(row.domain ?? "").trim();
    const verification = await verifyMarket({
      searchTerms: [summary, `${domain} ${summary}`.trim()].filter(Boolean),
      llm,
      model,
      naverClientId: process.env.NAVER_CLIENT_ID,
      naverClientSecret: process.env.NAVER_CLIENT_SECRET,
    });
    for (const key of Object.keys(counts) as Array<keyof VerificationCounts>) counts[key] += verification.counts[key];
    errors.push(...verification.errors.map(error => `${row.id}:${error}`));
    if (verification.usage) {
      calls++;
      inputTokens += verification.usage.inputTokens;
      outputTokens += verification.usage.outputTokens;
      cost += calculateLlmCost(verification.usage.model, verification.usage.inputTokens, verification.usage.outputTokens) ?? 0;
    }

    const f4 = scoreMarket(verification.verdict);
    const f5 = Math.max(score.f5, verification.verdict === "paid_exists" || verification.verdict === "crowded" ? 1 : 0);
    await supabaseRest(`competitors?pain_point_id=eq.${encodeURIComponent(String(row.id))}`, { method: "DELETE" });
    if (verification.products.length) {
      await supabaseRest("competitors", { method: "POST", body: JSON.stringify(verification.products.map(product => ({ ...product, pain_point_id: row.id }))) });
    }
    await supabaseRest("scores?on_conflict=pain_point_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ pain_point_id: row.id, f1: score.f1, f2: score.f2, f3: score.f3, f4, f5, f6: score.f6, data_access_stable: score.data_access_stable, verdict: verification.verdict }),
    });
    const newTotal = score.f1 + score.f2 + score.f3 + f4 + f5 + score.f6;
    after.push(newTotal);
    updated++;
    if (String(row.id) === maxOld.id) maxOldAfter = verification.products.length;
    process.stdout.write(`[${index + 1}/${targets.length}] ${verification.verdict} · ${verification.products.length} products · ${newTotal}/12\n`);
  } catch (error) {
    errors.push(`${row.id}:${error instanceof Error ? error.message : "failed"}`);
    after.push(score.total);
    process.stderr.write(`[${index + 1}/${targets.length}] failed: ${error instanceof Error ? error.message : "failed"}\n`);
  }
}

let nextIndex = 0;
async function worker() {
  while (nextIndex < targets.length) {
    const index = nextIndex++;
    await processRow(targets[index], index);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));

const stageCounts = {
  revalidated: targets.length,
  updated,
  competitorUrlExcluded: counts.urlExcluded,
  competitorProduct: counts.product + counts.appProduct,
  competitorContent: counts.content,
  competitorIrrelevant: counts.irrelevant,
  competitorAppProduct: counts.appProduct,
};
await supabaseRest("run_logs", {
  method: "POST",
  body: JSON.stringify({ started_at: startedAt, ended_at: new Date().toISOString(), stage_counts: stageCounts, llm_calls: { verify: calls, inputTokens, outputTokens }, cost_estimate: Number(cost.toFixed(4)), stopped_reason: null, errors }),
});

process.stdout.write(`${JSON.stringify({ updated, total: targets.length, stageCounts, cost: Number(cost.toFixed(4)), before: distribution(before), after: distribution(after), maxOld: { ...maxOld, after: maxOldAfter }, errors: errors.length }, null, 2)}\n`);
