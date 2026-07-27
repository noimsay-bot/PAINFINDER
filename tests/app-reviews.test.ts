import assert from "node:assert/strict";
import test from "node:test";
import { effectiveSourceWeights, allocateSourceTargets, buildStage1Prompt } from "../lib/pipeline";
import { hasIncumbentDissatisfaction, isPlayBlockError, isPlayScrapeEnabled, sameAppPain } from "../lib/app-reviews";
import { calculateFourScores } from "../lib/scoring";

test("앱 리뷰를 40% 주력 소스로 배분한다", () => {
  const weights = effectiveSourceWeights({}, true);
  assert.deepEqual(
    allocateSourceTargets(100, ["appreview", "blog", "kin", "cafearticle", "threads"], weights),
    { appreview: 40, blog: 20, kin: 10, cafearticle: 15, threads: 15 },
  );
});

test("Threads 미연결 15%는 앱 리뷰 10%와 블로그 5%로 재배분한다", () => {
  const weights = effectiveSourceWeights({}, false);
  assert.equal(weights.threads, 0);
  assert.equal(weights.appreview, 50);
  assert.equal(weights.blog, 25);
});

test("Google Play 수집은 기본 활성이고 명시적 false에서만 꺼진다", () => {
  assert.equal(isPlayScrapeEnabled(undefined), true);
  assert.equal(isPlayScrapeEnabled("true"), true);
  assert.equal(isPlayScrapeEnabled("false"), false);
});

test("403·429·차단 오류를 Google Play 소스 중단 신호로 감지한다", () => {
  assert.equal(isPlayBlockError(new Error("Response code 429")), true);
  assert.equal(isPlayBlockError(new Error("403 Forbidden")), true);
  assert.equal(isPlayBlockError(new Error("temporary parse error")), false);
});

test("다른 앱 탐색 표현에 인컴번트 불만족 가점을 준다", () => {
  const text = "내보내기 기능이 안 돼서 다른 앱을 찾고 있습니다";
  assert.equal(hasIncumbentDissatisfaction(text), true);
  assert.deepEqual(calculateFourScores({
    aiReplacementScore: 1,
    maintenanceScore: 1,
    moneySignal: null,
    verdict: "unverified",
    buyerContext: "individual_repeated",
    incumbentDissatisfaction: true,
  }), { f1: 1, f4: 2, f5: 1, f6: 1, total: 5 });
});

test("앱 리뷰 판정 프롬프트는 기능 불만만 통과시키고 단순 불만·일회성 버그를 제외한다", () => {
  const prompt = buildStage1Prompt([{ source: "playstore", title: "내보내기", body: "내보내기가 안 돼서 다른 앱을 찾습니다", promotional_signals: [], promotional_signal_score: 0 }]);
  assert.match(prompt, /특정 기능이 없거나 불편해서 생긴 반복적 불만/);
  assert.match(prompt, /단순 별점 불만/);
  assert.match(prompt, /일회성 버그/);
});

test("같은 앱의 양 플랫폼에서 유사한 불만이면 교차 확인한다", () => {
  assert.equal(sameAppPain("일정 내보내기 기능이 없어 업무가 불편하다", "일정 내보내기 기능이 안 돼서 다른 앱을 찾는다"), true);
  assert.equal(sameAppPain("알림 설정이 불편하다", "사진 업로드 화질이 낮다"), false);
});
