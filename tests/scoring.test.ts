import assert from "node:assert/strict";
import test from "node:test";
import { calculateFourScores, scorePayment } from "../lib/scoring";

test("새 4개 필터 총점은 최대 10점이다", () => {
  assert.deepEqual(calculateFourScores({
    aiReplacementScore: 2,
    maintenanceScore: 2,
    moneySignal: "월 3만원 지불 의사",
    verdict: "paid_exists",
    buyerContext: "business",
  }), { f1: 2, f4: 3, f5: 3, f6: 2, total: 10 });
});

test("지불 의향은 돈 신호와 구매자 맥락을 순서대로 반영한다", () => {
  assert.equal(scorePayment({ moneySignal: null, verdict: "empty", buyerContext: "business" }), 2);
  assert.equal(scorePayment({ moneySignal: null, verdict: "empty", buyerContext: "individual_repeated" }), 1);
  assert.equal(scorePayment({ moneySignal: null, verdict: "all_free", buyerContext: "hobby_or_oneoff" }), 0);
  assert.equal(scorePayment({ moneySignal: null, verdict: "crowded", buyerContext: "hobby_or_oneoff" }), 3);
});

test("미검증 후보는 인컴번트 점수를 부여하지 않고 7점 척도만 계산한다", () => {
  assert.deepEqual(calculateFourScores({
    aiReplacementScore: 2,
    maintenanceScore: 2,
    moneySignal: null,
    verdict: "unverified",
    buyerContext: "business",
  }), { f1: 2, f4: null, f5: 2, f6: 2, total: 6 });
});
