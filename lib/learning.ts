export const REJECTION_REASON_LABELS = {
  promotional: "광고·홍보",
  already_solved: "이미 해결됨",
  not_painpoint: "페인포인트 아님",
  market_too_small: "시장이 너무 작음",
  no_monetization: "수익화 불가",
  out_of_interest: "관심 밖 분야",
  inaccurate_summary: "요약이 부정확함",
  other: "기타",
} as const;

export type RejectionReasonCategory = keyof typeof REJECTION_REASON_LABELS;
export type LearningSuggestionType = "keyword" | "promotional_keyword" | "domain" | "prompt_example";

export const LEARNING_MIN_EVIDENCE = 2;

const LEGACY_REJECTION_REASON_MAP: Record<string, RejectionReasonCategory> = {
  solved: "already_solved",
  not_pain: "not_painpoint",
  small_market: "market_too_small",
  out_of_scope: "out_of_interest",
};

export function normalizeRejectionReasonCategory(value: unknown): RejectionReasonCategory | null {
  const key = String(value ?? "");
  if (Object.hasOwn(REJECTION_REASON_LABELS, key)) return key as RejectionReasonCategory;
  return LEGACY_REJECTION_REASON_MAP[key] ?? null;
}

export function rejectionReasonLabel(value: unknown) {
  const category = normalizeRejectionReasonCategory(value);
  return category ? REJECTION_REASON_LABELS[category] : null;
}

export function isRejectionReasonCategory(value: unknown): value is RejectionReasonCategory {
  return Object.hasOwn(REJECTION_REASON_LABELS, String(value));
}
