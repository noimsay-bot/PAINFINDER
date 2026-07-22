import OpenAI from "openai";
import { LlmProviderError, type LlmProvider, type LlmResult } from "./types";

const RETRY_DELAY_MS = 350;

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function describeError(error: unknown, attempts: number) {
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    const code = error.code;
    const retryable = status === 429
      ? code === "rate_limit_exceeded"
      : status === undefined || status >= 500;
    return new LlmProviderError(
      `OpenAI ${status ?? "connection"}${code ? ` (${code})` : ""}: ${error.message}`,
      { provider: "openai", status, code, retryable, attempts, requestId: error.requestID },
    );
  }
  return new LlmProviderError(
    `OpenAI connection: ${error instanceof Error ? error.message : "unknown error"}`,
    { provider: "openai", retryable: true, attempts },
  );
}

export class OpenAiProvider implements LlmProvider {
  private readonly client: OpenAI | null;

  constructor(apiKey = process.env.OPENAI_API_KEY, baseURL?: string, fetchImpl?: typeof fetch) {
    this.client = apiKey ? new OpenAI({ apiKey, baseURL, fetch: fetchImpl, maxRetries: 0 }) : null;
  }

  async complete(opts: Parameters<LlmProvider["complete"]>[0]): Promise<LlmResult> {
    if (!this.client) {
      throw new LlmProviderError("OpenAI 401 (missing_api_key): OPENAI_API_KEY missing", { provider: "openai", status: 401, code: "missing_api_key", retryable: false, attempts: 0 });
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await this.client.chat.completions.create({
          model: opts.model,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          response_format: opts.jsonMode ? { type: "json_object" } : undefined,
          max_completion_tokens: opts.maxOutputTokens ?? 4096,
        });
        return {
          text: res.choices[0]?.message?.content ?? "",
          inputTokens: res.usage?.prompt_tokens ?? 0,
          outputTokens: res.usage?.completion_tokens ?? 0,
          model: res.model,
        };
      } catch (error) {
        const failure = describeError(error, attempt);
        if (!failure.details.retryable || attempt === 2) throw failure;
        await wait(RETRY_DELAY_MS * attempt);
      }
    }
    throw new LlmProviderError("OpenAI: request failed", { provider: "openai", retryable: false, attempts: 2 });
  }
}

export function createOpenAiProvider(apiKey?: string, baseURL?: string, fetchImpl?: typeof fetch) {
  return new OpenAiProvider(apiKey, baseURL, fetchImpl);
}
