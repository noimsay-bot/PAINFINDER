import { persistRun, runPipeline } from "../lib/pipeline";

const queries = ["쿠팡 배송기사 구직", "병아리 소량 구매", "출퇴근 근태관리 불편"];

const result = await runPipeline({
  name: "판정 정밀화 검증",
  queries,
  sources: { naverCafe: true },
  auto_verify_top_n: 10,
  period_days: 7,
  limits: { queries: 3, itemsPerSource: 300, dailyCostUsd: 3 },
});

const runId = await persistRun(result);
const scoreDistribution = Object.fromEntries(
  [...new Set(result.candidates.map(candidate => candidate.scores.total))]
    .sort((a, b) => a - b)
    .map(score => [String(score), result.candidates.filter(candidate => candidate.scores.total === score).length]),
);

console.log(JSON.stringify({
  runId,
  queries,
  stageCounts: result.stageCounts,
  scoreDistribution,
  candidateCount: result.candidates.length,
  costEstimate: result.costEstimate,
  stoppedReason: result.stoppedReason,
  errors: result.errors,
}, null, 2));
