import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAiProvider } from "../lib/llm/openai";
import { calculateLlmCost } from "../lib/llm/pricing";
import { LlmProviderError } from "../lib/llm/types";

function completion(model = "gpt-5.4-mini") {
  return {
    id: "chatcmpl_test",
    object: "chat.completion",
    created: 0,
    model,
    choices: [{ index: 0, message: { role: "assistant", content: "{\"ok\":true}" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
}

const request = {
  model: "gpt-5.4-mini",
  system: "JSON으로 응답하라.",
  user: "테스트",
  jsonMode: true,
};

test("401은 재시도하지 않고 원문을 보존한다", async () => {
  let calls = 0;
  const fetchMock = async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } }), { status: 401, headers: { "content-type": "application/json" } });
  };
  await assert.rejects(createOpenAiProvider("wrong-key", undefined, fetchMock).complete(request), (error: unknown) => {
    assert.ok(error instanceof LlmProviderError);
    assert.equal(error.details.status, 401);
    assert.equal(error.details.attempts, 1);
    assert.match(error.message, /Incorrect API key provided/);
    return true;
  });
  assert.equal(calls, 1);
});

test("insufficient_quota 429는 재시도하지 않는다", async () => {
  let calls = 0;
  const fetchMock = async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: "Quota exhausted", type: "insufficient_quota", code: "insufficient_quota" } }), { status: 429, headers: { "content-type": "application/json" } });
  };
  await assert.rejects(createOpenAiProvider("test-key", undefined, fetchMock).complete(request), (error: unknown) => {
    assert.ok(error instanceof LlmProviderError);
    assert.equal(error.details.code, "insufficient_quota");
    assert.equal(error.details.attempts, 1);
    return true;
  });
  assert.equal(calls, 1);
});

test("rate_limit_exceeded 429는 한 번만 재시도한다", async () => {
  let calls = 0;
  const fetchMock = async () => {
    calls++;
    const body = calls === 1
      ? { error: { message: "Slow down", type: "rate_limit_error", code: "rate_limit_exceeded" } }
      : completion();
    return new Response(JSON.stringify(body), { status: calls === 1 ? 429 : 200, headers: { "content-type": "application/json" } });
  };
  const result = await createOpenAiProvider("test-key", undefined, fetchMock).complete(request);
  assert.equal(result.inputTokens, 100);
  assert.equal(result.outputTokens, 20);
  assert.equal(calls, 2);
});

test("토큰 사용량으로 비용을 계산하고 미등록 모델은 null을 반환한다", () => {
  assert.equal(calculateLlmCost("gpt-5.4-mini", 1_000_000, 1_000_000), 5.25);
  assert.equal(calculateLlmCost("unknown-model", 100, 100), null);
});
