import assert from "node:assert/strict";
import test from "node:test";
import {
  automaticHoldReason,
  buildReviewQueue,
  compactPainSummary,
  mergeSimilarCandidates,
  type ReviewQueueCandidate,
} from "../lib/review-queue";

function candidate(id: number, extra: Partial<ReviewQueueCandidate> = {}): ReviewQueueCandidate {
  return {
    id: String(id),
    summary: `판매자가 반복 업무 ${id} 때문에 엑셀로 정리하기 어렵다`,
    who: "온라인 판매자",
    domain: `분야${id % 4}`,
    score: 8,
    marketVerdict: "paid_exists",
    lowConfidence: false,
    decision: "unreviewed",
    recurrence: 1,
    bodyLength: 120,
    ...extra,
  };
}

test("낮은 점수·약한 붐빔·무료·공공·짧은 스니펫은 자동 정리한다", () => {
  assert.equal(automaticHoldReason(candidate(1, { score: 4 }), 5), "low_score");
  assert.equal(automaticHoldReason(candidate(2, { score: 5, marketVerdict: "crowded" }), 5), "crowded_weak");
  assert.equal(automaticHoldReason(candidate(3, { marketVerdict: "all_free" }), 5), "non_monetizable");
  assert.equal(automaticHoldReason(candidate(4, { marketVerdict: "public_owned" }), 5), "non_monetizable");
  assert.equal(automaticHoldReason(candidate(5, { lowConfidence: true }), 5), "insufficient_signal");
  assert.equal(automaticHoldReason(candidate(6, { score: 4, reviewOverride: true }), 5), null);
});

test("검토 큐는 상위 10개만 보이고 처리하면 다음 후보가 채워진다", () => {
  const items = Array.from({ length: 12 }, (_, index) => candidate(index + 1, { score: 20 - index, summary: `고유 문제 ${index + 1}` }));
  const first = buildReviewQueue(items, { queueSize: 10, minScore: 5 });
  assert.equal(first.queue.length, 10);
  const processed = items.map(item => item.id === first.queue[0].id ? { ...item, decision: "tracking" } : item);
  const next = buildReviewQueue(processed, { queueSize: 10, minScore: 5 });
  assert.equal(next.queue.length, 10);
  assert.ok(!next.queue.some(item => item.id === first.queue[0].id));
  assert.ok(next.queue.some(item => item.id === "11"));
});

test("표현만 다른 유사 후보는 대표 하나와 반복 횟수로 합친다", () => {
  const merged = mergeSimilarCandidates([
    candidate(1, { domain: "근태", summary: "알바생 근태 기록을 엑셀로 관리해서 출퇴근 누락이 생긴다" }),
    candidate(2, { domain: "근태", summary: "알바생 출퇴근 기록을 엑셀로 관리해 근태 누락이 생긴다" }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].duplicateCount, 1);
  assert.equal(merged[0].recurrence, 2);
});

test("큐에는 같은 분야가 세 건 연속 배치되지 않는다", () => {
  const items = [
    candidate(1, { domain: "근태", score: 10, summary: "문제 알파" }),
    candidate(2, { domain: "근태", score: 9, summary: "문제 베타" }),
    candidate(3, { domain: "근태", score: 8, summary: "문제 감마" }),
    candidate(4, { domain: "정산", score: 7, summary: "문제 델타" }),
  ];
  const queue = buildReviewQueue(items, { queueSize: 10, minScore: 5 }).queue;
  assert.deepEqual(queue.map(item => item.domain), ["근태", "근태", "정산", "근태"]);
});

test("목록용 요약은 누가와 무엇을 한 줄로 압축한다", () => {
  assert.equal(compactPainSummary("온라인 판매자", "온라인 판매자가 정산 누락 때문에 엑셀을 다시 확인한다"), "온라인 판매자 / 정산 누락 때문에 엑셀을 다시 확인한다");
});
