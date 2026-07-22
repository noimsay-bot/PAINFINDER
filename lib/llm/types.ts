export type LlmMessage = { role: "system" | "user"; content: string };

export type LlmResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
};

export interface LlmProvider {
  complete(opts: {
    model: string;
    system: string;
    user: string;
    jsonMode?: boolean;
    maxOutputTokens?: number;
  }): Promise<LlmResult>;
}

export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly details: {
      provider: "openai" | "anthropic";
      status?: number;
      code?: string | null;
      retryable: boolean;
      attempts: number;
      requestId?: string | null;
    },
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}
