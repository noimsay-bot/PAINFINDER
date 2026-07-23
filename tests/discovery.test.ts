import assert from "node:assert/strict";
import test from "node:test";
import { isActiveIndustryCode, isSoftwareRelevantVocabulary, ksicSection, rankCafeStats, sanitizeIndustryTranslation } from "../lib/discovery";

test("카페 랭킹은 통과 건수, 통과율 순으로 정렬한다", () => {
  const ranked = rankCafeStats([
    { cafeId: "small-perfect", collected: 5, passed: 5, passRate: 1 },
    { cafeId: "large-vein", collected: 100, passed: 30, passRate: 0.3 },
    { cafeId: "same-pass-lower-rate", collected: 20, passed: 5, passRate: 0.25 },
  ]);
  assert.deepEqual(ranked.map(row => row.cafeId), ["large-vein", "small-perfect", "same-pass-lower-rate"]);
});

test("서비스업 대분류만 활성화한다", () => {
  assert.equal(ksicSection("101"), "C");
  assert.equal(ksicSection("582"), "J");
  assert.equal(ksicSection("711"), "M");
  assert.equal(isActiveIndustryCode("101"), false);
  assert.equal(isActiveIndustryCode("582"), true);
  assert.equal(isActiveIndustryCode("711"), true);
});

test("물리 노동과 장비 어휘를 업종 번역 결과에서 제거한다", () => {
  const sanitized = sanitizeIndustryTranslation({
    roles: ["영상편집자"],
    tools: ["프리미어", "도축칼", "지게차"],
    tasks: ["시안 컨펌 관리", "필렛 뜬다", "납품 일정 관리", "세척 작업"],
  });
  assert.deepEqual(sanitized.tools, ["프리미어"]);
  assert.deepEqual(sanitized.tasks, ["시안 컨펌 관리", "납품 일정 관리"]);
  assert.equal(isSoftwareRelevantVocabulary("발골 작업"), false);
});
