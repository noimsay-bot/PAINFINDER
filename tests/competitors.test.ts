import assert from "node:assert/strict";
import test from "node:test";
import { classifyMarket, filterProductCandidates, isProductCandidateUrl, scoreMarket, type ProductCompetitor } from "../lib/competitors";

const product = (pricing: ProductCompetitor["pricing"], index = 0): ProductCompetitor => ({
  name: `제품 ${index}`,
  url: `https://product${index}.example.com`,
  pricing,
  quality_note: "공식 제품",
  last_updated_signal: null,
});

test("콘텐츠 플랫폼과 콘텐츠 경로를 URL 규칙으로 제외한다", () => {
  assert.equal(isProductCandidateUrl("https://blog.naver.com/example/1"), false);
  assert.equal(isProductCandidateUrl("https://example.com/news/launch"), false);
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
  assert.equal(scoreMarket("paid_exists"), 2);
  assert.equal(scoreMarket("all_free"), 0);
});
