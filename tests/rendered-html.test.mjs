import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("Painfinder 제품 화면과 주목 카페·검색어 발굴 메뉴를 서버 렌더링한다", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Painfinder — 페인포인트 검증 콘솔<\/title>/);
  assert.match(html, /PAIN<strong>FINDER<\/strong>/);
  assert.match(html, /주목 카페·발굴/);
  assert.match(html, /실제 데이터를 불러오는 중입니다/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Codex is working/i);
});

test("미검증 표시와 승인형 검색어 발굴 경로를 코드에 고정한다", async () => {
  const [page, dashboard, scoring, discovery, schema, pipeline, runRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/scoring.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/pipeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/run/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /unverified:\s*"미검증"/);
  assert.match(page, /인컴번트 미포함/);
  assert.match(dashboard, /precisionVerified \? marketVerdict\(score\.verdict\) : "unverified"/);
  assert.match(dashboard, /row\.stopped_reason \? "stopped" : "completed"/);
  assert.match(scoring, /f4:\s*number \| null/);
  assert.match(discovery, /body\.action === "approve"/);
  assert.match(discovery, /body\.action === "mine-text"/);
  assert.match(discovery, /body\.action === "translate-industries"/);
  assert.match(discovery, /industryIds/);
  assert.match(discovery, /active=eq\.true/);
  assert.match(schema, /create table if not exists industry_seeds/);
  assert.match(schema, /create table if not exists cafe_names/);
  assert.match(schema, /create table if not exists query_discoveries/);
  assert.doesNotMatch(page, /Math\.min\(86/);
  assert.match(page, /response\.headers\.get\("content-type"\)/);
  assert.match(page, /response\.status === 504/);
  assert.match(pipeline, /resolution=merge-duplicates,return=representation/);
  assert.match(pipeline, /stoppedReason \?\?= "time_budget"/);
  assert.match(runRoute, /MANUAL_RUN_LIMITS\.LLM1_MAX_CALLS/);
});

test("시장 포화 교정과 승인형 거부 학습 경로를 코드에 고정한다", async () => {
  const [page, dashboard, decisions, learning, competitors, ruleFilter, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/decisions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/learning/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/competitors.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/rule-filter.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260723_scoring_rule_learning.sql", import.meta.url), "utf8"),
  ]);
  assert.match(competitors, /paidCount >= 5 \|\| products\.length >= 5/);
  assert.match(page, /crowded:\s*"붐빔"/);
  assert.match(dashboard, /\.filter\(candidate => !candidate\.ruleRejected\)/);
  assert.match(dashboard, /marketPriority\(b\.marketVerdict\) - marketPriority\(a\.marketVerdict\)/);
  assert.match(decisions, /reason_category:\s*reasonCategory/);
  assert.match(learning, /evidence_count=gte\.\$\{LEARNING_MIN_EVIDENCE\}/);
  assert.match(learning, /addActiveFilter/);
  assert.match(ruleFilter, /classifyFinalRuleRejection/);
  assert.match(migration, /alter table learning_suggestions enable row level security/);
  assert.match(migration, /when paid_count >= 5 or product_count >= 5 then 'crowded'/);
});

test("광고 판정·소스 비중·스니펫 신뢰도와 대체 링크를 코드에 고정한다", async () => {
  const [page, dashboard, pipeline, decisions, learning, schema, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/pipeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/decisions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/learning/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260725_promotional_snippet_sources.sql", import.meta.url), "utf8"),
  ]);
  assert.match(pipeline, /is_promotional=true이면 반드시 pass=false/);
  assert.match(pipeline, /promotional:\s*rejectReasonCounts\.promotional/);
  assert.match(pipeline, /kin:\s*35[\s\S]*blog:\s*30[\s\S]*cafearticle:\s*35/);
  assert.match(pipeline, /source_counts/);
  assert.match(page, /원문 스니펫 전문/);
  assert.match(page, /네이버에서 검색/);
  assert.match(page, /판단 재료 부족/);
  assert.match(page, /카페 가입이 필요할 수 있음/);
  assert.match(dashboard, /b\.bodyLength - a\.bodyLength/);
  assert.match(decisions, /extractPromotionalExclusionTerms/);
  assert.match(learning, /promotional_keyword/);
  assert.match(schema, /raw_payload jsonb/);
  assert.match(migration, /update raw_items[\s\S]*low_confidence = char_length\(body\) < 40/);
});

test("24시간 숨김·재처리 차단·사유 기반 필터 이력과 취소를 코드에 고정한다", async () => {
  const [page, dashboard, decisions, learning, pipeline, visibility, filters, schema, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/decisions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/learning/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/pipeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/candidate-visibility.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/filter-additions.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260725_rejection_filter_history.sql", import.meta.url), "utf8"),
  ]);
  assert.match(visibility, /24 \* 60 \* 60 \* 1000/);
  assert.match(dashboard, /hiddenFromToday:\s*shouldHideRejectedFromToday/);
  assert.match(page, /todayItems[\s\S]*shouldHideRejectedFromToday/);
  assert.match(page, /recently-rejected/);
  assert.match(page, /const archived = items\.filter/);
  assert.match(decisions, /status: body\.action === "rejected" \? "rejected_by_user" : "analyzed"/);
  assert.match(pipeline, /status=eq\.rejected_by_user/);
  assert.match(pipeline, /excludeByActiveKeywordFilters/);
  assert.match(decisions, /reasonCategory === "not_painpoint"/);
  assert.match(decisions, /reasonCategory === "out_of_interest"/);
  assert.doesNotMatch(decisions, /reasonCategory === "already_solved"/);
  assert.match(learning, /body\.action === "revoke-filter"/);
  assert.match(filters, /revoked_at: new Date\(\)\.toISOString\(\)/);
  assert.match(page, /자동 반영됨/);
  assert.match(page, /반영 취소/);
  assert.match(schema, /create table if not exists filter_additions/);
  assert.match(migration, /mode text not null check \(mode in \('auto','approved'\)\)/);
});

test("주목 카페 관리·조준 수집·원문 우대·자동 실행 슬롯을 코드에 고정한다", async () => {
  const [page, dashboard, watchedRoute, watchedHelper, pipeline, automaticRun, schema, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/watched-cafes/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/watched-cafes.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/pipeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/run-execution.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260725_watched_cafes.sql", import.meta.url), "utf8"),
  ]);
  assert.match(page, /주목 카페만/);
  assert.match(page, /가입한 카페 · 원문 열람 가능/);
  assert.match(page, /원문 크게 보기/);
  assert.match(page, /특정 카페만 검색할 수 없습니다/);
  assert.match(watchedRoute, /body\.action === "focus"/);
  assert.match(watchedRoute, /sources:\s*\{\s*naverCafe:\s*true\s*\}/);
  assert.match(watchedHelper, /WATCHED_CAFE_QUERY_SLOTS = 4/);
  assert.match(watchedHelper, /url\.searchParams\.get\("clubid"\)/);
  assert.match(pipeline, /normalizeWatchedStage1Result/);
  assert.match(pipeline, /Number\(b\.watched\) - Number\(a\.watched\)/);
  assert.match(automaticRun, /AUTO_RUN_LIMITS\.MAX_QUERIES - watchedQueries\.length/);
  assert.match(dashboard, /watchedCafeName/);
  assert.match(schema, /create table if not exists watched_cafes/);
  assert.match(migration, /alter table raw_items add column if not exists watched/);
});
