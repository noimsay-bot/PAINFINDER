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

test("Painfinder 제품 화면과 검색어 발굴 메뉴를 서버 렌더링한다", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Painfinder — 페인포인트 검증 콘솔<\/title>/);
  assert.match(html, /PAIN<strong>FINDER<\/strong>/);
  assert.match(html, /검색어 발굴/);
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
  assert.match(decisions, /reason_category:\s*reasonCategory/);
  assert.match(learning, /evidence_count=gte\.\$\{LEARNING_MIN_EVIDENCE\}/);
  assert.match(learning, /rule_exclusions\?on_conflict=kind,value/);
  assert.match(ruleFilter, /classifyFinalRuleRejection/);
  assert.match(migration, /alter table learning_suggestions enable row level security/);
  assert.match(migration, /when paid_count >= 5 or product_count >= 5 then 'crowded'/);
});
