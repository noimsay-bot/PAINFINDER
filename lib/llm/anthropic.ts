import { LlmProviderError, type LlmProvider, type LlmResult } from "./types";

const RETRY_DELAY_MS = 350;

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class AnthropicProvider implements LlmProvider {
  constructor(private readonly apiKey = process.env.ANTHROPIC_API_KEY) {}

  async complete(opts: Parameters<LlmProvider["complete"]>[0]): Promise<LlmResult> {
    if (!this.apiKey) {
      throw new LlmProviderError("Anthropic: ANTHROPIC_API_KEY missing", { provider: "anthropic", status: 401, code: "missing_api_key", retryable: false, attempts: 0 });
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: opts.model,
            system: opts.system,
            max_tokens: opts.maxOutputTokens ?? 4096,
            messages: [{ role: "user", content: opts.user }],
          }),
        });
        const payload = await response.json() as {
          content?: Array<{ type: string; text?: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
          model?: string;
          error?: { type?: string; message?: string };
        };
        if (!response.ok) {
          const code = payload.error?.type ?? null;
          const retryable = response.status === 429 || response.status >= 500;
          const failure = new LlmProviderError(
            `Anthropic ${response.status}${code ? ` (${code})` : ""}: ${payload.error?.message ?? "요청이 거부되었습니다."}`,
            { provider: "anthropic", status: response.status, code, retryable, attempts: attempt, requestId: response.headers.get("request-id") },
          );
          if (!retryable || attempt === 2) throw failure;
          await wait(RETRY_DELAY_MS * attempt);
          continue;
        }
        return {
          text: payload.content?.find(content => content.type === "text")?.text ?? "",
          inputTokens: payload.usage?.input_tokens ?? 0,
          outputTokens: payload.usage?.output_tokens ?? 0,
          model: payload.model ?? opts.model,
        };
      } catch (error) {
        if (error instanceof LlmProviderError) throw error;
        const failure = new LlmProviderError(
          `Anthropic connection: ${error instanceof Error ? error.message : "unknown error"}`,
          { provider: "anthropic", retryable: true, attempts: attempt },
        );
        if (attempt === 2) throw failure;
        await wait(RETRY_DELAY_MS * attempt);
      }
    }
    throw new LlmProviderError("Anthropic: request failed", { provider: "anthropic", retryable: false, attempts: 2 });
  }
}

export function createAnthropicProvider(apiKey?: string) {
  return new AnthropicProvider(apiKey);
}
