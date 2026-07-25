import assert from "node:assert/strict";
import test from "node:test";
import { createAppMarketSearchContext, searchAppMarket } from "../lib/competitors";
import { applyManualRunLimits } from "../lib/run-policy";
import { RUN_TIME_BUDGET, hasRunProcessingBudget } from "../lib/limits";

test("수동 실행은 검색어·소스·수집량·검증 상한을 서버에서 강제한다", () => {
  const queries = Array.from({ length: 10 }, (_, index) => `검색어 ${index + 1}`);
  const limited = applyManualRunLimits({
    queries,
    sources: { naverCafe: true, naverKin: true, naverBlog: true },
    auto_verify_top_n: 40,
    limits: { queries: 10, itemsPerSource: 500, dailyCostUsd: 3 },
  }, queries);

  assert.equal(limited.config.queries?.length, 5);
  assert.deepEqual(Object.keys(limited.config.sources ?? {}), ["naverCafe", "naverKin", "naverBlog"]);
  assert.equal(limited.config.limits?.itemsPerSource, 50);
  assert.equal(limited.config.auto_verify_top_n, 10);
  assert.equal(limited.requestedSourceCount, 3);
  assert.equal(limited.executedSourceCount, 3);
});

test("iTunes 검색은 실행 내 캐시로 같은 검색어의 중복 호출을 제거한다", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const context = createAppMarketSearchContext(0);
    await Promise.all([
      searchAppMarket("근태관리", context),
      searchAppMarket("근태관리", context),
    ]);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("iTunes 429는 재시도 없이 항목 오류로 남기고 실행을 계속한다", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("rate limited", { status: 429 });
  };
  try {
    const result = await searchAppMarket("근태관리", createAppMarketSearchContext(0));
    assert.equal(calls, 3);
    assert.equal(result.products.length, 0);
    assert.equal(result.errors.length, 3);
    assert.ok(result.errors.every(error => error.includes("iTunes 429")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("저장 여유 시간 30초를 침범하기 전에 처리 단계를 중단한다", () => {
  const now = 1_000_000;
  assert.equal(hasRunProcessingBudget(now + RUN_TIME_BUDGET.PERSISTENCE_RESERVE_MS, now), false);
  assert.equal(hasRunProcessingBudget(now + RUN_TIME_BUDGET.PERSISTENCE_RESERVE_MS + 1, now), true);
});
