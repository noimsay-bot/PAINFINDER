import assert from "node:assert/strict";
import test from "node:test";
import { effectiveSourceWeights, allocateSourceTargets, buildStage1Prompt, isNaverCollectionEnabled, isThreadsApprovalPending } from "../lib/pipeline";
import { hasIncumbentDissatisfaction, isPlayBlockError, isPlayScrapeEnabled, sameAppPain } from "../lib/app-reviews";
import { calculateFourScores } from "../lib/scoring";

test("Threads 키워드 승인 전 앱 리뷰 85%·HN 15%로 배분한다", () => {
  const weights = effectiveSourceWeights({}, false);
  assert.deepEqual(
    allocateSourceTargets(100, ["appreview", "hn"], weights),
    { appreview: 85, hn: 15 },
  );
});

test("Threads 키워드 승인 후 Threads·앱 리뷰 45%와 HN 10%로 배분한다", () => {
  const weights = effectiveSourceWeights({}, true);
  assert.deepEqual(
    allocateSourceTargets(100, ["appreview", "threads", "hn"], weights),
    { appreview: 45, threads: 45, hn: 10 },
  );
});

test("네이버는 명시적 환경 설정에서만 다시 활성화된다", () => {
  assert.equal(isNaverCollectionEnabled(undefined), false);
  assert.equal(isNaverCollectionEnabled("false"), false);
  assert.equal(isNaverCollectionEnabled("true"), true);
});

test("Threads 권한 오류는 승인 대기 신호로 분류한다", () => {
  assert.equal(isThreadsApprovalPending(403, { error: { message: "Missing permission threads_keyword_search" } }), true);
  assert.equal(isThreadsApprovalPending(400, { error: { message: "Application needs approval" } }), true);
  assert.equal(isThreadsApprovalPending(500, { error: { message: "server error" } }), false);
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
