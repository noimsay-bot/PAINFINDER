import type { MarketVerdict } from "./competitors";

export const DEFAULT_REVIEW_QUEUE_SIZE = 10;
export const DEFAULT_REVIEW_QUEUE_MIN_SCORE = 5;
export const MAX_CONSECUTIVE_QUEUE_DOMAIN = 2;

export type ReviewStatus = "eligible" | "auto_held" | "insufficient_signal";
export type AutoHoldReason = "low_score" | "crowded_weak" | "non_monetizable" | "insufficient_signal";

export type ReviewQueueCandidate = {
  id: string;
  summary: string;
  who: string;
  domain: string;
  score: number;
  marketVerdict: MarketVerdict;
  lowConfidence: boolean;
  watched?: boolean;
  decision: string;
  recurrence: number;
  reviewStatus?: ReviewStatus;
  reviewReason?: string | null;
  reviewOverride?: boolean;
  bodyLength?: number;
};

export type ReviewSettings = {
  queueSize: number;
  minScore: number;
};

const SUMMARY_STOPWORDS = new Set([
  "사람", "사용자", "담당자", "업체", "회사", "업무", "관리", "문제", "불편", "어려움",
  "하고", "하는", "해야", "있다", "없다", "위해", "때문에", "경우", "대한", "관련",
]);

function normalizedTokens(value: string) {
  return new Set(value
    .toLocaleLowerCase("ko-KR")
    .replace(/[^가-힣a-z0-9]+/g, " ")
    .split(/\s+/)
    .map(token => token.replace(/(?:으로|에서|에게|까지|부터|처럼|하고|하며|하는|해야|된다|되어|이다|있다|없다|한다|한다면|들이|에게)$/g, ""))
    .filter(token => token.length >= 2 && !SUMMARY_STOPWORDS.has(token)));
}

export function summarySimilarity(left: string, right: string) {
  const a = normalizedTokens(left);
  const b = normalizedTokens(right);
  if (a.size < 3 || b.size < 3) return 0;
  const intersection = [...a].filter(token => b.has(token)).length;
  if (intersection < 3) return 0;
  return intersection / (a.size + b.size - intersection);
}

export function compactPainSummary(who: string, summary: string, maxLength = 96) {
  const normalizedWho = who.replace(/\s+/g, " ").trim() || "대상 미분류";
  let pain = summary.replace(/\s+/g, " ").trim();
  if (pain.startsWith(normalizedWho)) pain = pain.slice(normalizedWho.length).replace(/^[이가은는을를,\s]+/, "");
  const compact = pain.length > maxLength ? `${pain.slice(0, maxLength - 1).trim()}…` : pain;
  return `${normalizedWho} / ${compact || "불편 내용 미분류"}`;
}

export function automaticHoldReason(
  candidate: Pick<ReviewQueueCandidate, "score" | "marketVerdict" | "lowConfidence" | "reviewOverride">,
  minScore = DEFAULT_REVIEW_QUEUE_MIN_SCORE,
): AutoHoldReason | null {
  if (candidate.reviewOverride) return null;
  if (candidate.lowConfidence) return "insufficient_signal";
  if (candidate.marketVerdict === "all_free" || candidate.marketVerdict === "public_owned") return "non_monetizable";
  if (candidate.marketVerdict === "crowded" && candidate.score < Math.max(6, minScore)) return "crowded_weak";
  if (candidate.score < minScore) return "low_score";
  return null;
}

export function reviewStatusFor(
  candidate: Pick<ReviewQueueCandidate, "score" | "marketVerdict" | "lowConfidence" | "reviewOverride">,
  minScore = DEFAULT_REVIEW_QUEUE_MIN_SCORE,
) {
  const reason = automaticHoldReason(candidate, minScore);
  return {
    status: reason === "insufficient_signal" ? "insufficient_signal" as const : reason ? "auto_held" as const : "eligible" as const,
    reason,
  };
}

export function mergeSimilarCandidates<T extends ReviewQueueCandidate>(candidates: T[]) {
  const groups: Array<{ representative: T; members: T[] }> = [];
  const sorted = [...candidates].sort((a, b) =>
    b.score - a.score
    || Number(Boolean(b.watched)) - Number(Boolean(a.watched))
    || (b.bodyLength ?? 0) - (a.bodyLength ?? 0));

  for (const candidate of sorted) {
    const group = groups.find(entry =>
      entry.representative.domain === candidate.domain
      && summarySimilarity(entry.representative.summary, candidate.summary) >= 0.3);
    if (group) group.members.push(candidate);
    else groups.push({ representative: candidate, members: [candidate] });
  }

  return groups.map(group => ({
    ...group.representative,
    recurrence: Math.max(
      group.representative.recurrence,
      group.members.reduce((sum, item) => sum + Math.max(1, item.recurrence), 0),
    ),
    duplicateIds: group.members.slice(1).map(item => item.id),
    duplicateCount: group.members.length - 1,
  }));
}

export function spreadQueueDomains<T extends ReviewQueueCandidate>(candidates: T[], maxConsecutive = MAX_CONSECUTIVE_QUEUE_DOMAIN) {
  const remaining = [...candidates];
  const result: T[] = [];
  while (remaining.length) {
    const last = result[result.length - 1];
    let streak = 0;
    for (let index = result.length - 1; index >= 0 && last && result[index].domain === last.domain; index--) streak++;
    let nextIndex = 0;
    if (last && streak >= maxConsecutive) {
      const diverseIndex = remaining.findIndex(candidate => candidate.domain !== last.domain);
      if (diverseIndex >= 0) nextIndex = diverseIndex;
    }
    result.push(remaining.splice(nextIndex, 1)[0]);
  }
  return result;
}

export function buildReviewQueue<T extends ReviewQueueCandidate>(
  candidates: T[],
  settings: ReviewSettings = { queueSize: DEFAULT_REVIEW_QUEUE_SIZE, minScore: DEFAULT_REVIEW_QUEUE_MIN_SCORE },
) {
  const unreviewed = candidates.filter(candidate => candidate.decision === "unreviewed");
  const autoHeld = unreviewed.filter(candidate => automaticHoldReason(candidate, settings.minScore));
  const eligible = unreviewed.filter(candidate => !automaticHoldReason(candidate, settings.minScore));
  const representatives = mergeSimilarCandidates(eligible);
  const ranked = representatives.sort((a, b) =>
    b.score - a.score
    || Number(Boolean(b.watched)) - Number(Boolean(a.watched))
    || b.recurrence - a.recurrence);
  const diversified = spreadQueueDomains(ranked);
  return {
    queue: diversified.slice(0, settings.queueSize),
    remaining: diversified,
    autoHeld,
    duplicateCount: representatives.reduce((sum, candidate) => sum + candidate.duplicateCount, 0),
  };
}

export function reviewedToday(candidate: Pick<ReviewQueueCandidate, "decision"> & { decidedAt?: string | null }, now = new Date()) {
  if (candidate.decision === "unreviewed" || !candidate.decidedAt) return false;
  const decided = new Date(candidate.decidedAt);
  if (Number.isNaN(decided.getTime())) return false;
  return decided.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })
    === now.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
}
