export const REJECTION_REASON_LABELS = {
  solved: "이미 해결됨",
  not_pain: "페인포인트 아님",
  small_market: "시장이 너무 작음",
  no_monetization: "수익화 불가",
  out_of_scope: "관심 밖 분야",
  inaccurate_summary: "요약이 부정확함",
  other: "기타",
} as const;

export type RejectionReasonCategory = keyof typeof REJECTION_REASON_LABELS;
export type LearningSuggestionType = "keyword" | "domain" | "prompt_example";

export const LEARNING_MIN_EVIDENCE = 2;

export function isRejectionReasonCategory(value: unknown): value is RejectionReasonCategory {
  return Object.hasOwn(REJECTION_REASON_LABELS, String(value));
}
