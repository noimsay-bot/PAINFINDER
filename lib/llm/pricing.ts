type ModelPrice = { inputPerMillion: number; outputPerMillion: number };

const MODEL_PRICING: Record<string, ModelPrice> = {
  "gpt-5.4-mini": { inputPerMillion: 0.75, outputPerMillion: 4.5 },
  "gpt-5.4-mini-2026-03-17": { inputPerMillion: 0.75, outputPerMillion: 4.5 },
  "gpt-5.5": { inputPerMillion: 5, outputPerMillion: 30 },
  "gpt-5.5-2026-04-23": { inputPerMillion: 5, outputPerMillion: 30 },
};

export function calculateLlmCost(model: string, inputTokens: number, outputTokens: number) {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  return (inputTokens * pricing.inputPerMillion + outputTokens * pricing.outputPerMillion) / 1_000_000;
}
