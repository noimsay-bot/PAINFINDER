import { createAnthropicProvider } from "./anthropic";
import { createOpenAiProvider } from "./openai";
import type { LlmProvider } from "./types";

export * from "./types";

export type LlmStage = "stage1" | "stage2";

function providerName() {
  return process.env.LLM_PROVIDER?.toLowerCase() === "anthropic" ? "anthropic" : "openai";
}

export function getLlmProvider(): LlmProvider {
  return providerName() === "anthropic" ? createAnthropicProvider() : createOpenAiProvider();
}

export function resolveLlmModel(stored: string | undefined, stage: LlmStage) {
  if (providerName() === "anthropic") {
    if (stored?.startsWith("claude-")) return stored;
    return stage === "stage1"
      ? process.env.ANTHROPIC_MODEL_STAGE1 ?? "claude-haiku-4-5-20251001"
      : process.env.ANTHROPIC_MODEL_STAGE2 ?? "claude-sonnet-5";
  }

  const fallback = stage === "stage1"
    ? process.env.OPENAI_MODEL_STAGE1 ?? "gpt-5.4-mini"
    : process.env.OPENAI_MODEL_STAGE2 ?? "gpt-5.4-mini";
  if (stored?.startsWith("claude-")) return fallback;
  return stored ?? fallback;
}
