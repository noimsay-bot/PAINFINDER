export const REJECTION_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

const HIDDEN_TODAY_SOURCES = new Set(["cafearticle", "kin"]);

export function shouldShowInToday(source: unknown, runId: unknown, latestRunId: unknown) {
  if (HIDDEN_TODAY_SOURCES.has(String(source ?? ""))) return false;
  return !latestRunId || String(runId ?? "") === String(latestRunId);
}

export function isRejectedDecision(action: unknown) {
  return String(action ?? "") === "rejected";
}

export function shouldHideRejectedFromToday(action: unknown, decidedAt: unknown, now = Date.now()) {
  if (!isRejectedDecision(action)) return false;
  const decided = new Date(String(decidedAt ?? "")).getTime();
  return Number.isFinite(decided) && now - decided >= REJECTION_GRACE_PERIOD_MS;
}

export function isRecentlyRejected(action: unknown, decidedAt: unknown, now = Date.now()) {
  if (!isRejectedDecision(action)) return false;
  const decided = new Date(String(decidedAt ?? "")).getTime();
  return Number.isFinite(decided) && now - decided < REJECTION_GRACE_PERIOD_MS;
}

export function isRejectedBodyCompactionEligible(action: unknown, decidedAt: unknown, now = Date.now(), retentionDays = 90) {
  if (!isRejectedDecision(action)) return false;
  const decided = new Date(String(decidedAt ?? "")).getTime();
  return Number.isFinite(decided) && now - decided >= retentionDays * 24 * 60 * 60 * 1000;
}
