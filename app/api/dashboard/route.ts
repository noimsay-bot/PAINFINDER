import { NextResponse } from "next/server";
import { supabaseRest } from "@/lib/pipeline";
import type { MarketVerdict } from "@/lib/competitors";
import { rejectionReasonLabel, normalizeRejectionReasonCategory } from "@/lib/learning";
import { isRecentlyRejected, shouldHideRejectedFromToday } from "@/lib/candidate-visibility";
import { compactPainSummary, DEFAULT_REVIEW_QUEUE_MIN_SCORE, DEFAULT_REVIEW_QUEUE_SIZE } from "@/lib/review-queue";
import { parseNaverCafeId } from "@/lib/watched-cafes";
import { sameAppPain } from "@/lib/app-reviews";

type Row = Record<string, unknown>;

const PAIN_POINT_SELECT = "pain_points?select=id,pain_summary,who,current_workaround,frequency,money_signal,domain,signal_type,recurrence_count,precision_verified_at,created_at,raw_items(source,url,title,body,posted_at,status,reject_reason,query_origin,source_name,author_name,body_length,low_confidence,promotional_signals,promotional_signal_score,promotional_rule_flagged,is_promotional,highlight_terms,watched,watched_cafe_id,review_status,review_status_reason,review_override,app_target_id,app_name,review_platform,review_score,app_version,incumbent_dissatisfaction,watched_cafes(cafe_name)),scores(f1,f2,f3,f4,f5,f6,total,data_access_stable,verdict),competitors(name,url,pricing,quality_note,last_updated_signal,seller_name,source),decisions(action,reason,reason_category,reason_note,decided_at)&order=created_at.desc&limit=500";
const LEGACY_PAIN_POINT_SELECT = "pain_points?select=id,pain_summary,who,current_workaround,frequency,money_signal,domain,signal_type,recurrence_count,precision_verified_at,created_at,raw_items(source,url,title,body,posted_at,status,reject_reason,query_origin,source_name,author_name,body_length,low_confidence,promotional_signals,promotional_signal_score,promotional_rule_flagged,is_promotional,highlight_terms,watched,watched_cafe_id,review_status,review_status_reason,review_override,watched_cafes(cafe_name)),scores(f1,f2,f3,f4,f5,f6,total,data_access_stable,verdict),competitors(name,url,pricing,quality_note,last_updated_signal,seller_name,source),decisions(action,reason,reason_category,reason_note,decided_at)&order=created_at.desc&limit=500";

async function fetchPainRows() {
  try {
    return await supabaseRest(PAIN_POINT_SELECT) as Row[] | null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/app_target_id|app_name|review_platform|review_score|app_version|incumbent_dissatisfaction|PGRST/i.test(message)) throw error;
    return await supabaseRest(LEGACY_PAIN_POINT_SELECT) as Row[] | null;
  }
}

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
  return ({ cafearticle: "네이버 카페", kin: "지식iN", blog: "네이버 블로그", webkr: "웹문서", appstore: "앱 리뷰", playstore: "앱 리뷰", threads: "Threads", hn: "HN" } as Record<string, string>)[source] ?? source;
}

function sourceTone(source: string) {
  return ({ cafearticle: "cafe", kin: "kin", blog: "blog", appstore: "app", playstore: "app", threads: "threads", hn: "hn" } as Record<string, string>)[source] ?? "web";
}

function marketVerdict(value: unknown): MarketVerdict {
  return ["unverified", "empty", "all_free", "public_owned", "paid_exists", "crowded"].includes(String(value))
    ? String(value) as MarketVerdict
    : "empty";
}

function marketPriority(verdict: MarketVerdict) {
  return ({ paid_exists: 5, empty: 4, crowded: 3, unverified: 2, all_free: 1, public_owned: 0 } as const)[verdict];
}

export async function GET() {
  try {
    const [painRows, logRows, reviewSettingRows, activeWatchedRows] = await Promise.all([
      fetchPainRows(),
      supabaseRest("run_logs?select=id,started_at,ended_at,stage_counts,llm_calls,cost_estimate,stopped_reason,errors,run_configs(name)&order=started_at.desc&limit=50"),
      supabaseRest("review_settings?id=eq.1&select=queue_size,min_score&limit=1"),
      supabaseRest("watched_cafes?active=eq.true&select=cafe_id,cafe_name"),
    ]) as [Row[] | null, Row[] | null, Row[] | null, Row[] | null];
    const activeWatched = new Map((activeWatchedRows ?? []).map(row => [
      String(row.cafe_id).toLocaleLowerCase("ko-KR"),
      { cafeId: String(row.cafe_id), cafeName: String(row.cafe_name) },
    ]));

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
        seller: rival.seller_name ? String(rival.seller_name) : null,
        source: String(rival.source ?? "web"),
      }));
      const legacyScore = (score.f2 !== null && score.f2 !== undefined) || (score.f3 !== null && score.f3 !== undefined);
      const precisionVerified = Boolean(row.precision_verified_at);
      const incumbentScore = score.f4 === null || score.f4 === undefined ? null : Number(score.f4);
      const incumbentKnown = Boolean(raw.incumbent_dissatisfaction);
      const storedTotal = Number(score.total ?? 0);
      const reasonCategory = normalizeRejectionReasonCategory(latest.reason_category);
      const reasonLabel = rejectionReasonLabel(reasonCategory) ?? String(latest.reason ?? "");
      const reasonNote = String(latest.reason_note ?? "").trim();
      const decision = String(latest.action ?? "unreviewed");
      const decidedAt = latest.decided_at ? String(latest.decided_at) : null;
      const originalTitle = String(raw.title ?? "");
      const bodyLength = Number(raw.body_length ?? String(raw.body ?? "").length);
      const parsedCafeId = source === "cafearticle" ? parseNaverCafeId(raw.url) : null;
      const watchedCafe = parsedCafeId ? activeWatched.get(parsedCafeId.toLocaleLowerCase("ko-KR")) : null;
      const who = String(row.who ?? "대상 미분류");
      const summary = String(row.pain_summary ?? "요약 없음");
      return {
        id: String(row.id),
        summary,
        compactSummary: compactPainSummary(who, summary),
        who,
        sourceKey: source,
        source: sourceLabel(source),
        sourceTone: sourceTone(source),
        time: relativeTime(raw.posted_at ?? row.created_at),
        postedAt: raw.posted_at ? String(raw.posted_at) : null,
        score: precisionVerified || incumbentKnown ? storedTotal : Math.max(0, storedTotal - (incumbentScore ?? 0)),
        scoreMax: precisionVerified ? (legacyScore ? 12 : 10) : incumbentKnown ? (legacyScore ? 11 : 9) : (legacyScore ? 9 : 7),
        competitors: rivals.length,
        paidCompetitors: rivals.filter(rival => rival.pricing === "paid" || rival.pricing === "freemium").length,
        marketVerdict: precisionVerified ? marketVerdict(score.verdict) : "unverified",
        precisionVerified,
        precisionVerifiedAt: row.precision_verified_at ? String(row.precision_verified_at) : null,
        decision,
        decisionReason: reasonLabel ? `${reasonLabel}${reasonNote ? ` · ${reasonNote}` : ""}` : null,
        decisionReasonCategory: reasonCategory || null,
        decidedAt,
        hiddenFromToday: shouldHideRejectedFromToday(decision, decidedAt),
        recentlyRejected: isRecentlyRejected(decision, decidedAt),
        domain: String(row.domain ?? "미분류"),
        frequency: ({ daily: "매일", weekly: "매주", monthly: "매월", occasional: "비정기" } as Record<string, string>)[String(row.frequency)] ?? "빈도 미상",
        signal: String(row.signal_type ?? "LLM 통과"),
        excerpt: String(raw.body ?? raw.title ?? "원문 없음"),
        originalTitle,
        bodyLength,
        lowConfidence: raw.low_confidence === undefined ? bodyLength < 40 : Boolean(raw.low_confidence),
        isPromotional: Boolean(raw.is_promotional),
        promotionalSignals: Array.isArray(raw.promotional_signals) ? raw.promotional_signals.map(String) : [],
        promotionalSignalScore: Number(raw.promotional_signal_score ?? 0),
        promotionalRuleFlagged: Boolean(raw.promotional_rule_flagged),
        highlightTerms: Array.isArray(raw.highlight_terms) ? raw.highlight_terms.map(String) : [],
        sourceName: raw.source_name ? String(raw.source_name) : null,
        isAppReview: source === "appstore" || source === "playstore",
        appTargetId: raw.app_target_id === null || raw.app_target_id === undefined ? null : String(raw.app_target_id),
        appName: raw.app_name ? String(raw.app_name) : null,
        reviewPlatform: raw.review_platform ? String(raw.review_platform) : null,
        reviewScore: raw.review_score === null || raw.review_score === undefined ? null : Number(raw.review_score),
        appVersion: raw.app_version ? String(raw.app_version) : null,
        incumbentDissatisfaction: Boolean(raw.incumbent_dissatisfaction),
        crossPlatform: false,
        watched: Boolean(watchedCafe),
        watchedCafeId: watchedCafe?.cafeId ?? null,
        watchedCafeName: watchedCafe?.cafeName ?? (raw.source_name ? String(raw.source_name) : null),
        reviewStatus: String(raw.review_status ?? "eligible"),
        reviewReason: raw.review_status_reason ? String(raw.review_status_reason) : null,
        reviewOverride: Boolean(raw.review_override),
        authorName: raw.author_name ? String(raw.author_name) : null,
        isCafe: source === "cafearticle",
        naverSearchUrl: `https://search.naver.com/search.naver?query=${encodeURIComponent(originalTitle)}`,
        workaround: String(row.current_workaround ?? "확인되지 않음"),
        money: row.money_signal ? String(row.money_signal) : null,
        recurrence: Number(row.recurrence_count ?? 1),
        access: Boolean(score.data_access_stable),
        scores: [
          { label: "AI 대체 불가성", value: Number(score.f1 ?? 0), max: 2 },
          { label: "인컴번트 상태", value: precisionVerified || incumbentKnown ? incumbentScore : null, max: 3 },
          { label: "지불 의향", value: Number(score.f5 ?? 0), max: 3 },
          { label: "유지보수 부담", value: Number(score.f6 ?? 0), max: 2 },
        ],
        rivals,
        url: String(raw.url ?? ""),
        origin: String(raw.query_origin ?? "unknown"),
        ruleRejected: Boolean(raw.reject_reason) || String(raw.status ?? "") === "rule_rejected",
        createdAt: String(row.created_at ?? ""),
      };
    }).filter(candidate => !candidate.ruleRejected)
      .sort((a, b) =>
        Number(a.hiddenFromToday) - Number(b.hiddenFromToday)
        ||
        Number(b.watched) - Number(a.watched)
        ||
        Number(b.precisionVerified) - Number(a.precisionVerified)
        || b.score - a.score
        || Number(["kin", "blog"].includes(b.sourceTone)) - Number(["kin", "blog"].includes(a.sourceTone))
        || b.bodyLength - a.bodyLength
        || marketPriority(b.marketVerdict) - marketPriority(a.marketVerdict)
        || b.createdAt.localeCompare(a.createdAt)
      );

    for (const candidate of candidates) {
      if (!candidate.isAppReview || !candidate.appTargetId || !candidate.reviewPlatform) continue;
      candidate.crossPlatform = candidates.some(other =>
        other.id !== candidate.id
        && other.appTargetId === candidate.appTargetId
        && Boolean(other.reviewPlatform)
        && other.reviewPlatform !== candidate.reviewPlatform
        && sameAppPain(candidate.summary, other.summary)
      );
    }

    const sourcePerformance = Object.fromEntries([...new Set(candidates.map(candidate => candidate.sourceKey))].map(source => {
      const relevant = candidates.filter(candidate => candidate.sourceKey === source);
      const tracked = relevant.filter(candidate => candidate.decision === "tracking").length;
      return [source, { candidates: relevant.length, tracked, trackingRate: relevant.length ? tracked / relevant.length : 0 }];
    }));

    const logs = (logRows ?? []).map((row) => ({
      id: String(row.id),
      startedAt: String(row.started_at ?? ""),
      endedAt: row.ended_at ? String(row.ended_at) : null,
      preset: String(one(row.run_configs).name ?? "기본 실행"),
      status: row.ended_at ? (row.stopped_reason ? "stopped" : "completed") : "running",
      stageCounts: { ...((row.stage_counts as Row | null) ?? {}), source_tracking_rates: sourcePerformance },
      llmCalls: (row.llm_calls as Row | null) ?? {},
      cost: Number(row.cost_estimate ?? 0),
      stoppedReason: row.stopped_reason ? String(row.stopped_reason) : null,
      errors: Array.isArray(row.errors) ? row.errors.map(String) : [],
    }));

    const reviewRow = reviewSettingRows?.[0] ?? {};
    return NextResponse.json({
      candidates,
      logs,
      reviewSettings: {
        queueSize: Number(reviewRow.queue_size ?? DEFAULT_REVIEW_QUEUE_SIZE),
        minScore: Number(reviewRow.min_score ?? DEFAULT_REVIEW_QUEUE_MIN_SCORE),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "데이터를 불러오지 못했습니다.";
    const setupRequired = message.includes("PGRST205") || message.includes("Could not find the table");
    return NextResponse.json({ candidates: [], logs: [], setupRequired, error: message }, { status: setupRequired ? 503 : 500 });
  }
}
