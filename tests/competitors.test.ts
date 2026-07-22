import assert from "node:assert/strict";
import test from "node:test";
import { buildAppSearchTerms, buildPrecisionSearchTerms, classifyMarket, filterProductCandidates, isProductCandidateUrl, scoreMarket, type ProductCompetitor } from "../lib/competitors";

const product = (pricing: ProductCompetitor["pricing"], index = 0): ProductCompetitor => ({
  name: `제품 ${index}`,
  url: `https://product${index}.example.com`,
  pricing,
  quality_note: "공식 제품",
  last_updated_signal: null,
  seller_name: null,
  source: "web",
});

test("콘텐츠 플랫폼과 콘텐츠 경로를 URL 규칙으로 제외한다", () => {
  assert.equal(isProductCandidateUrl("https://blog.naver.com/example/1"), false);
  assert.equal(isProductCandidateUrl("https://example.com/news/launch"), false);
  assert.equal(isProductCandidateUrl("https://www.yes24.com/product/goods/123"), false);
  assert.equal(isProductCandidateUrl("https://www.inflearn.com/course/example"), false);
  assert.equal(isProductCandidateUrl("https://agency.example.com/proposal.pdf"), false);
  assert.equal(isProductCandidateUrl("https://agency.go.kr/download/file.xlsx"), false);
  assert.equal(isProductCandidateUrl("https://example.com/pricing"), true);
});

test("URL 필터는 후보와 제외 개수를 분리한다", () => {
  const result = filterProductCandidates([
    { title: "후기", link: "https://blog.naver.com/a", description: "글" },
    { title: "공식 제품", link: "https://service.example.com", description: "가입 가능" },
  ]);
  assert.equal(result.excluded, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.url, "https://service.example.com/");
});

test("시장 판정은 개수가 아니라 가격 성격을 따른다", () => {
  assert.equal(classifyMarket([]), "empty");
  assert.equal(classifyMarket([product("free")]), "all_free");
  assert.equal(classifyMarket([product("public")]), "public_owned");
  assert.equal(classifyMarket([product("paid")]), "paid_exists");
  assert.equal(classifyMarket(Array.from({ length: 5 }, (_, index) => product("freemium", index))), "crowded");
  assert.equal(scoreMarket("paid_exists"), 3);
  assert.equal(scoreMarket("empty"), 2);
  assert.equal(scoreMarket("crowded"), 1);
  assert.equal(scoreMarket("all_free"), 0);
});

test("앱 마켓과 정밀 검증 검색어는 도메인의 핵심어만 사용한다", () => {
  assert.deepEqual(buildAppSearchTerms("출퇴근 근태관리"), ["출퇴근 근태 관리", "출퇴근 근태 프로그램", "출퇴근 근태관리"]);
  assert.deepEqual(buildPrecisionSearchTerms("출퇴근 근태관리"), ["출퇴근 근태관리 프로그램", "출퇴근 근태관리 솔루션", "출퇴근 근태관리 관리 시스템"]);
});
