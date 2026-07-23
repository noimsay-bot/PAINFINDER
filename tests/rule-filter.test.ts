import assert from "node:assert/strict";
import test from "node:test";
import { classifyFinalRuleRejection, extractRuleSuggestionTerms } from "../lib/rule-filter";

const classify = (title: string, body = "", domain = "") =>
  classifyFinalRuleRejection({ title, body, domain });

test("저장 직전 게이트가 대표 오탐 유형을 검증 여부와 무관하게 제외한다", () => {
  assert.equal(classify("쿠팡 배송 자리 구하는 방법"), "구직");
  assert.equal(classify("냉동 병아리 50마리 단위 구매 가능한 곳"), "구매문의");
  assert.equal(classify("모니터를 오래 봐서 목과 어깨 통증"), "신체");
  assert.equal(classify("신사업장 이전 후 주차 문제와 식대 상승"), "일회성");
  assert.equal(classify("당구 큐대 마찰 줄이는 제품 구매"), "구매문의");
  assert.equal(classify("예식 신부 입장 음원 편집 시간"), "일회성");
});

test("업무 도구로 해결 가능한 반복 관리 문제는 통과시킨다", () => {
  assert.equal(classify("여러 지점의 교대근무표와 휴가 승인을 한곳에서 관리하기 어렵다"), null);
});

test("사용자가 승인한 제외 키워드와 도메인만 추가 룰로 적용한다", () => {
  assert.equal(
    classifyFinalRuleRejection(
      { title: "정산자리 배정이 복잡합니다", body: "", domain: "물류 운영" },
      [{ kind: "keyword", value: "정산자리" }],
    ),
    "제외키워드",
  );
  assert.equal(
    classifyFinalRuleRejection(
      { title: "반복 관리 문제", body: "", domain: "관심 밖 분야" },
      [{ kind: "domain", value: "관심 밖" }],
    ),
    "제외도메인",
  );
});

test("거부 원문에서 승인 후보가 될 특징어를 중복 없이 추출한다", () => {
  const terms = extractRuleSuggestionTerms("정산자리 배정과 냉동 병아리 50마리 단위 구매가 어렵습니다");
  assert.ok(terms.includes("50마리 단위"));
  assert.ok(terms.includes("정산자리"));
  assert.equal(new Set(terms).size, terms.length);
});
