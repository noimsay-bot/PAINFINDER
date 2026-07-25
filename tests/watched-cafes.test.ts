import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWatchedStage1Result } from "../lib/pipeline";
import { cafeNameFromHtml, isUsableCafeName } from "../lib/cafe-names";
import { buildWatchedCafeQueries, inferWatchedCafeTopicSeeds, matchWatchedCafe, parseNaverCafeId, type WatchedCafe } from "../lib/watched-cafes";

const watchedCafe: WatchedCafe = {
  cafe_id: "happyboss",
  cafe_name: "아프니까 사장이다",
  topic_seeds: ["임대료", "배달수수료", "알바", "매출"],
  active: true,
};

test("네이버 카페 원문 URL에서 카페 ID를 정확히 읽고 다른 호스트는 거부한다", () => {
  assert.equal(parseNaverCafeId("https://cafe.naver.com/happyboss/123456"), "happyboss");
  assert.equal(parseNaverCafeId("https://cafe.naver.com/f-e/cafes/23611966/articles/123456"), "23611966");
  assert.equal(parseNaverCafeId("https://cafe.naver.com/ArticleRead.nhn?clubid=23611966&articleid=123456"), "23611966");
  assert.equal(parseNaverCafeId("https://blog.naver.com/happyboss/123456"), null);
});

test("주목 카페 조준 검색은 네 개 슬롯을 만들고 URL 일치 결과만 표시한다", () => {
  const queries = buildWatchedCafeQueries([watchedCafe], 4);
  assert.equal(queries.length, 4);
  assert.ok(queries.every(item => item.cafeId === "happyboss"));
  assert.equal(matchWatchedCafe("https://cafe.naver.com/happyboss/123", [watchedCafe])?.cafe_name, "아프니까 사장이다");
  assert.equal(matchWatchedCafe("https://cafe.naver.com/another/123", [watchedCafe]), null);
});

test("후보에서 즉석 추가할 때 같은 카페의 분야와 요약에서 주제어를 자동 생성한다", () => {
  const seeds = inferWatchedCafeTopicSeeds([
    { domain: "근태관리", painSummary: "알바생 출퇴근 기록과 급여 계산을 수기로 처리한다" },
    { domain: "근태관리", painSummary: "직원 출퇴근 기록과 근무표를 함께 확인하기 어렵다" },
    { domain: "급여정산", painSummary: "알바 급여 계산이 반복되어 실수가 생긴다" },
  ], "알바관리");
  assert.equal(seeds[0], "알바관리");
  assert.ok(seeds.includes("근태관리"));
  assert.ok(seeds.includes("급여정산"));
  assert.ok(!seeds.includes("관리"));
});

test("카페 공개 메타데이터에서 이름을 보정하고 cafe_id 임시명은 구분한다", () => {
  assert.equal(cafeNameFromHtml('<title>아프니까 사장이다 : 네이버 카페</title>'), "아프니까 사장이다");
  assert.equal(cafeNameFromHtml('<meta property="og:title" content="좋은 사장들 - 네이버 카페">'), "좋은 사장들");
  assert.equal(isUsableCafeName("happyboss", "happyboss"), false);
  assert.equal(isUsableCafeName("아프니까 사장이다", "happyboss"), true);
});

test("주목 카페의 짧고 애매한 신호는 통과시키되 광고·구직·구매는 그대로 막는다", () => {
  const borderline = normalizeWatchedStage1Result(
    { watched: true, low_confidence: true },
    { id: "0", pass: false, is_promotional: false, reject_reason: "기타" },
  );
  assert.equal(borderline.pass, true);
  assert.match(borderline.reason ?? "", /원문 확인 필요/);

  for (const rejectReason of ["promotional", "홍보", "구직", "구매문의"] as const) {
    const rejected = normalizeWatchedStage1Result(
      { watched: true, low_confidence: true },
      { id: "0", pass: false, is_promotional: rejectReason === "promotional", reject_reason: rejectReason },
    );
    assert.equal(rejected.pass, false);
  }
});
