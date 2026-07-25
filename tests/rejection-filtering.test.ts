import assert from "node:assert/strict";
import test from "node:test";
import { isRecentlyRejected, shouldHideRejectedFromToday } from "../lib/candidate-visibility";
import { revokeFilterAddition } from "../lib/filter-additions";
import { normalizeRejectionReasonCategory } from "../lib/learning";
import { excludeByActiveKeywordFilters, excludePreviouslyRejectedByUser } from "../lib/pipeline";
import { extractPromotionalExclusionTerms } from "../lib/promotional";
import { extractSafeAutoExclusionTerms, isSafeAutoExclusionTerm } from "../lib/rule-filter";

test("기각 후보는 24시간 동안 흐리게 남고 그 뒤 오늘 목록에서 숨긴다", () => {
  const now = Date.parse("2026-07-25T12:00:00Z");
  const recent = "2026-07-24T12:00:01Z";
  const expired = "2026-07-24T12:00:00Z";
  assert.equal(isRecentlyRejected("rejected", recent, now), true);
  assert.equal(shouldHideRejectedFromToday("rejected", recent, now), false);
  assert.equal(shouldHideRejectedFromToday("rejected", expired, now), true);
  assert.equal(shouldHideRejectedFromToday("holding", expired, now), false);
});

test("rejected_by_user 원문과 활성 키워드 대상은 LLM 처리 전에 제외한다", () => {
  const items = [
    { source: "kin", source_id: "1", title: "반복 정산 문제", body: "매일 어렵다" },
    { source: "blog", source_id: "2", title: "배송 자리 구직", body: "찾습니다" },
  ];
  const rejected = excludePreviouslyRejectedByUser(items, [{ source: "kin", source_id: "1" }]);
  assert.equal(rejected.excluded, 1);
  assert.equal(rejected.kept[0].source_id, "2");
  const filtered = excludeByActiveKeywordFilters(items, [{ kind: "keyword", value: "배송 자리" }]);
  assert.equal(filtered.excluded, 1);
  assert.equal(filtered.kept[0].source_id, "1");
});

test("명백한 오탐 자동 키워드는 일반어와 2글자 이하를 버린다", () => {
  const terms = extractSafeAutoExclusionTerms("회사 업무 관리 문제지만 정산자리 배정과 냉동 병아리 50마리 단위 구매 문의입니다");
  assert.ok(terms.includes("정산자리"));
  assert.ok(terms.includes("50마리 단위"));
  assert.equal(terms.includes("회사"), false);
  assert.equal(terms.includes("업무"), false);
  assert.equal(terms.includes("관리"), false);
  assert.equal(terms.includes("문제지만"), false);
  assert.equal(isSafeAutoExclusionTerm("회사"), false);
  assert.equal(isSafeAutoExclusionTerm("앱"), false);
});

test("광고 기각은 제품명과 유도어를 자동 제외 후보로 추출한다", () => {
  const terms = extractPromotionalExclusionTerms("재고마스터 쓰고 나서 해결됐어요. 링크는 프로필, 무료체험 상담 신청!");
  assert.ok(terms.includes("재고마스터"));
  assert.ok(terms.includes("링크는 프로필"));
  assert.ok(terms.includes("무료체험"));
  assert.ok(terms.includes("상담 신청"));
});

test("기존 기각 사유는 새 분류명으로 호환하고 이미 해결됨은 독립 분류한다", () => {
  assert.equal(normalizeRejectionReasonCategory("not_pain"), "not_painpoint");
  assert.equal(normalizeRejectionReasonCategory("out_of_scope"), "out_of_interest");
  assert.equal(normalizeRejectionReasonCategory("solved"), "already_solved");
  assert.equal(normalizeRejectionReasonCategory("already_solved"), "already_solved");
});

test("필터 이력을 취소하면 활성 이력이 없을 때 룰 제외도 비활성화한다", async () => {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const requests: Array<{ url: string; method: string; body: string }> = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-secret";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
    if (url.includes("filter_additions?id=eq.7&select=")) {
      return new Response(JSON.stringify([{ id: 7, keyword: "재고마스터", kind: "keyword", active: true }]), { status: 200 });
    }
    if (url.includes("filter_additions?kind=eq.keyword")) {
      return new Response("[]", { status: 200 });
    }
    return new Response(null, { status: 204 });
  };
  try {
    assert.equal(await revokeFilterAddition(7), true);
    assert.ok(requests.some(request => request.url.includes("filter_additions?id=eq.7") && request.method === "PATCH" && request.body.includes('"active":false')));
    assert.ok(requests.some(request => request.url.includes("rule_exclusions?") && request.method === "PATCH" && request.body.includes('"active":false')));
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});
