import { NextResponse } from "next/server";
import { supabaseRest } from "@/lib/pipeline";
import type { MarketVerdict } from "@/lib/competitors";

type Row = Record<string, unknown>;

function one(value: unknown): Row {
  if (Array.isArray(value)) return (value[0] as Row | undefined) ?? {};
  return (value as Row | null) ?? {};
}

function relativeTime(value: unknown) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return "시간 미상";
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / 1440)}일 전`;
}

function sourceLabel(source: string) {
  return ({ cafearticle: "네이버 카페", kin: "지식iN", blog: "네이버 블로그", webkr: "웹문서", appstore: "앱 리뷰", threads: "Threads", hn: "HN" } as Record<string, string>)[source] ?? source;
}

function sourceTone(source: string) {
  return ({ cafearticle: "cafe", kin: "kin", blog: "blog", appstore: "app", threads: "threads", hn: "hn" } as Record<string, string>)[source] ?? "web";
}

function marketVerdict(value: unknown): MarketVerdict {
  return ["empty", "all_free", "public_owned", "paid_exists", "crowded"].includes(String(value))
    ? String(value) as MarketVerdict
    : "empty";
}

export async function GET() {
  try {
    const [painRows, logRows] = await Promise.all([
      supabaseRest("pain_points?select=id,pain_summary,who,current_workaround,frequency,money_signal,domain,signal_type,recurrence_count,created_at,raw_items(source,url,title,body,posted_at),scores(f1,f2,f3,f4,f5,f6,total,data_access_stable,verdict),competitors(name,url,pricing,quality_note,last_updated_signal),decisions(action,reason,decided_at)&order=created_at.desc&limit=200"),
      supabaseRest("run_logs?select=id,started_at,ended_at,stage_counts,llm_calls,cost_estimate,stopped_reason,errors,run_configs(name)&order=started_at.desc&limit=50"),
    ]) as [Row[] | null, Row[] | null];

    const candidates = (painRows ?? []).map((row) => {
      const raw = one(row.raw_items);
      const score = one(row.scores);
      const decisions = Array.isArray(row.decisions) ? [...row.decisions] as Row[] : [];
      decisions.sort((a, b) => String(b.decided_at ?? "").localeCompare(String(a.decided_at ?? "")));
      const latest = decisions[0] ?? {};
      const source = String(raw.source ?? "unknown");
      const rivals = (Array.isArray(row.competitors) ? row.competitors as Row[] : []).map((rival) => ({
        name: String(rival.name ?? "이름 미상"),
        url: String(rival.url ?? ""),
        pricing: String(rival.pricing ?? "가격 미확인"),
        note: String(rival.quality_note ?? "검토 메모 없음"),
        state: String(rival.pricing ?? "unknown"),
      }));
      return {
        id: String(row.id),
        summary: String(row.pain_summary ?? "요약 없음"),
        who: String(row.who ?? "대상 미분류"),
        source: sourceLabel(source),
        sourceTone: sourceTone(source),
        time: relativeTime(raw.posted_at ?? row.created_at),
        score: Number(score.total ?? 0),
        competitors: rivals.length,
        marketVerdict: marketVerdict(score.verdict),
        decision: String(latest.action ?? "unreviewed"),
        decisionReason: latest.reason ? String(latest.reason) : null,
        decidedAt: latest.decided_at ? String(latest.decided_at) : null,
        domain: String(row.domain ?? "미분류"),
        frequency: ({ daily: "매일", weekly: "매주", monthly: "매월", occasional: "비정기" } as Record<string, string>)[String(row.frequency)] ?? "빈도 미상",
        signal: String(row.signal_type ?? "LLM 통과"),
        excerpt: String(raw.body ?? raw.title ?? "원문 없음"),
        workaround: String(row.current_workaround ?? "확인되지 않음"),
        money: row.money_signal ? String(row.money_signal) : null,
        recurrence: Number(row.recurrence_count ?? 1),
        access: Boolean(score.data_access_stable),
        scores: [
          { label: "AI 대체 불가성", value: Number(score.f1 ?? 0) },
          { label: "기술 진입장벽", value: Number(score.f2 ?? 0) },
          { label: "포털 비대체성", value: Number(score.f3 ?? 0) },
          { label: "인컴번트 상태", value: Number(score.f4 ?? 0) },
          { label: "지불 의향", value: Number(score.f5 ?? 0) },
          { label: "유지보수 부담", value: Number(score.f6 ?? 0) },
        ],
        rivals,
        url: String(raw.url ?? ""),
      };
    });

    const logs = (logRows ?? []).map((row) => ({
      id: String(row.id),
      startedAt: String(row.started_at ?? ""),
      endedAt: row.ended_at ? String(row.ended_at) : null,
      preset: String(one(row.run_configs).name ?? "기본 실행"),
      status: row.ended_at ? (row.stopped_reason || (Array.isArray(row.errors) && row.errors.some(error => !String(error).startsWith("warning:"))) ? "stopped" : "completed") : "running",
      stageCounts: (row.stage_counts as Row | null) ?? {},
      llmCalls: (row.llm_calls as Row | null) ?? {},
      cost: Number(row.cost_estimate ?? 0),
      stoppedReason: row.stopped_reason ? String(row.stopped_reason) : null,
      errors: Array.isArray(row.errors) ? row.errors.map(String) : [],
    }));

    return NextResponse.json({ candidates, logs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "데이터를 불러오지 못했습니다.";
    const setupRequired = message.includes("PGRST205") || message.includes("Could not find the table");
    return NextResponse.json({ candidates: [], logs: [], setupRequired, error: message }, { status: setupRequired ? 503 : 500 });
  }
}
