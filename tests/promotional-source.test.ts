import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNaverPostdate, normalizeNaverText } from "../lib/naver";
import { allocateSourceTargets, buildStage1Prompt, normalizeStage1Result } from "../lib/pipeline";
import { detectPromotionalSignals, extractPromotionalProductNames } from "../lib/promotional";

test("과거 불편 뒤 제품 만족으로 끝나는 글은 광고 신호와 제품명을 추출한다", () => {
  const text = "예전엔 엑셀로 재고 관리하느라 밤샜는데 재고마스터 쓰고 나서 해결됐어요";
  const result = detectPromotionalSignals({ source: "cafearticle", title: "재고 관리 후기", body: text });
  assert.deepEqual(result.signals, ["positive_product", "resolved_now"]);
  assert.ok(result.flagged);
  assert.deepEqual(extractPromotionalProductNames(text), ["재고마스터"]);
});

test("블로그는 동일한 약한 추천 신호에도 더 낮은 광고 임계값을 쓴다", () => {
  const input = { title: "업무 앱 후기", body: "재고마스터 추천해요" };
  assert.equal(detectPromotionalSignals({ source: "blog", ...input }).flagged, true);
  assert.equal(detectPromotionalSignals({ source: "cafearticle", ...input }).flagged, false);
  const prompt = buildStage1Prompt([
    { source: "blog", ...input, promotional_signals: ["positive_product"], promotional_signal_score: 2 },
  ]);
  assert.match(prompt, /blog 소스는 협찬 가능성이 높으므로 더 낮은 광고 임계값/);
});

test("LLM이 광고로 판정하면 pass 응답이 와도 promotional 기각으로 강제한다", () => {
  assert.deepEqual(
    normalizeStage1Result({ pass: true, is_promotional: true, type: "1", reason: "반복 불편" }, "0"),
    { id: "0", pass: false, is_promotional: true, type: undefined, reason: undefined, reject_reason: "promotional" },
  );
});

test("네이버 자동 수집 기본 비중은 지식iN 35 · 블로그 30 · 카페 35다", () => {
  assert.deepEqual(
    allocateSourceTargets(100, ["kin", "blog", "cafearticle"]),
    { kin: 35, blog: 30, cafearticle: 35 },
  );
});

test("네이버 원문 필드는 HTML만 정리하고 게시일은 저장 가능한 시각으로 바꾼다", () => {
  assert.equal(normalizeNaverText("<b>재고</b>&nbsp;관리 &amp; 정산"), "재고 관리 & 정산");
  assert.equal(normalizeNaverPostdate("20260725"), "2026-07-25T00:00:00+09:00");
});

