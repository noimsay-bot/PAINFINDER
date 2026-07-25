"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { REJECTION_REASON_LABELS, type RejectionReasonCategory } from "@/lib/learning";
import { isRecentlyRejected, shouldHideRejectedFromToday } from "@/lib/candidate-visibility";

type View = "today" | "signals" | "discovery" | "settings" | "archive" | "logs";
type Decision = "unreviewed" | "tracking" | "holding" | "rejected";
type MarketVerdict = "unverified" | "empty" | "all_free" | "public_owned" | "paid_exists" | "crowded";
type CompetitorPricing = "free" | "freemium" | "paid" | "public" | "unknown";

type Candidate = {
  id: string;
  summary: string;
  who: string;
  source: string;
  sourceTone: string;
  time: string;
  postedAt: string | null;
  score: number;
  scoreMax: number;
  competitors: number;
  paidCompetitors: number;
  marketVerdict: MarketVerdict;
  precisionVerified: boolean;
  precisionVerifiedAt: string | null;
  decision: Decision;
  domain: string;
  frequency: string;
  signal: string;
  excerpt: string;
  originalTitle: string;
  bodyLength: number;
  lowConfidence: boolean;
  isPromotional: boolean;
  promotionalSignals: string[];
  promotionalSignalScore: number;
  promotionalRuleFlagged: boolean;
  highlightTerms: string[];
  sourceName: string | null;
  authorName: string | null;
  isCafe: boolean;
  naverSearchUrl: string;
  workaround: string;
  money: string | null;
  recurrence: number;
  access: boolean;
  scores: { label: string; value: number | null; max: number }[];
  rivals: { name: string; url: string; pricing: CompetitorPricing; note: string; state: CompetitorPricing; seller: string | null; source: string }[];
  url: string;
  decisionReason?: string | null;
  decidedAt?: string | null;
  decisionReasonCategory?: string | null;
  origin?: string;
  hiddenFromToday: boolean;
  recentlyRejected: boolean;
};

type RunLog = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  preset: string;
  status: "completed" | "running" | "stopped";
  stageCounts: Record<string, unknown>;
  llmCalls: Record<string, number>;
  cost: number;
  stoppedReason: string | null;
  errors: string[];
};

const NAV: { id: View; label: string; mark: string; count?: number }[] = [
  { id: "today", label: "오늘의 후보", mark: "01" },
  { id: "signals", label: "반복 신호", mark: "02" },
  { id: "discovery", label: "검색어 발굴", mark: "03" },
  { id: "settings", label: "실행 설정", mark: "04" },
  { id: "archive", label: "보류함", mark: "05" },
  { id: "logs", label: "실행 로그", mark: "06" },
];

const STATUS_LABEL: Record<Decision, string> = {
  unreviewed: "미검토", tracking: "추적", holding: "보류", rejected: "기각",
};

const MARKET_LABEL: Record<MarketVerdict, string> = {
  unverified: "미검증", paid_exists: "유료 존재", crowded: "붐빔", all_free: "전부 무료", public_owned: "공공 제공", empty: "경쟁자 없음",
};

function marketLabel(item: Pick<Candidate, "marketVerdict" | "competitors" | "paidCompetitors">) {
  const withCount = ["paid_exists", "crowded", "all_free"].includes(item.marketVerdict);
  const count = item.marketVerdict === "paid_exists" ? item.paidCompetitors : item.competitors;
  return `${MARKET_LABEL[item.marketVerdict]}${withCount ? ` (${count})` : ""}`;
}

const PRICING_LABEL: Record<CompetitorPricing, string> = {
  free: "무료", freemium: "부분 무료", paid: "유료", public: "공공 제공", unknown: "가격 미확인",
};

function buildCandidatesText(items: Candidate[]) {
  const createdAt = new Date().toLocaleString("ko-KR");
  const sections = items.map((item, index) => {
    const scores = item.scores.map(score => `- ${score.label}: ${score.value === null ? "미검증" : `${score.value}/${score.max}`}`).join("\n");
    const rivals = item.precisionVerified && item.rivals.length
      ? item.rivals.map((rival, rivalIndex) => [
          `  ${rivalIndex + 1}. ${rival.name}`,
          `     가격: ${PRICING_LABEL[rival.pricing]}`,
          `     설명: ${rival.note}`,
          `     제공자: ${rival.seller ?? "확인 불가"}`,
          `     출처: ${rival.source === "appstore" ? "App Store" : "웹 정밀 검증"}`,
          `     URL: ${rival.url}`,
        ].join("\n")).join("\n")
      : item.precisionVerified ? "  확인된 제품 경쟁자 없음" : "  미검증 — 아직 제품 경쟁자를 정밀 검색하지 않음";

    return [
      `================ 후보 ${String(index + 1).padStart(2, "0")} ================`,
      `ID: PF-${item.id}`,
      `요약: ${item.summary}`,
      `대상: ${item.who}`,
      `분야: ${item.domain}`,
      `출처: ${item.source}`,
      `발생 빈도: ${item.frequency}`,
      `신호 유형: ${item.signal}`,
      `반복 횟수: ${item.recurrence}회`,
      `현재 판정: ${STATUS_LABEL[item.decision]}`,
      `시장 판정: ${marketLabel(item)}`,
      `총점: ${item.score}/${item.scoreMax}${item.precisionVerified ? "" : " (인컴번트 미포함)"}`,
      `정밀 검증: ${item.precisionVerified ? "완료" : "미실행"}`,
      "",
      "[원문 신호]",
      item.excerpt,
      `원문 URL: ${item.url || "없음"}`,
      "",
      "[LLM 분석]",
      `현재 우회 수단: ${item.workaround}`,
      `지불 신호: ${item.money ?? "명시적 신호 없음"}`,
      "",
      "[4개 필터 점수]",
      scores,
      "",
      "[확인된 제품 경쟁자]",
      rivals,
    ].join("\n");
  });

  return [
    "PAINFINDER — 오늘의 후보 내보내기",
    `생성 시각: ${createdAt}`,
    `후보 수: ${items.length}건`,
    "용도: 후보 추출·요약·경쟁 검증·점수 프롬프트를 개선하기 위한 Claude 검토용 자료",
    "",
    "검토 요청: 잘못 통과한 후보, 요약 왜곡, 경쟁자 오분류, 점수 근거가 약한 항목을 찾아 개선 의견을 제안해 주세요.",
    "",
    ...sections,
  ].join("\n\n");
}

function downloadCandidatesText(items: Candidate[]) {
  const blob = new Blob([`\uFEFF${buildCandidatesText(items)}`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const date = new Date().toLocaleDateString("sv-SE");
  anchor.href = url;
  anchor.download = `painfinder-today-${date}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function ScoreGauge({ score, max }: { score: number; max: number }) {
  return <span className={`score score-${score >= max * .8 ? "high" : score >= max * .6 ? "mid" : "low"}`}><strong>{score}</strong><small>/{max}</small></span>;
}

function HighlightText({ text, terms }: { text: string; terms: string[] }) {
  const safeTerms = [...new Set(terms.map(term => term.trim()).filter(term => term.length >= 2))]
    .sort((a, b) => b.length - a.length);
  if (!safeTerms.length) return <>{text}</>;
  const pattern = new RegExp(`(${safeTerms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(pattern).map((part, index) =>
    safeTerms.some(term => term.toLocaleLowerCase("ko-KR") === part.toLocaleLowerCase("ko-KR"))
      ? <mark key={`${part}-${index}`}>{part}</mark>
      : part
  )}</>;
}

function Topbar({ title, subtitle, dark, setDark }: { title: string; subtitle: string; dark: boolean; setDark: (v: boolean) => void }) {
  return (
    <header className="topbar">
      <div><div className="eyebrow">PAINFINDER / {title}</div><h1>{title}</h1><p>{subtitle}</p></div>
      <div className="top-actions">
        <span className="live-dot"><i /> 개인 연구 콘솔</span>
        <button className="icon-button" onClick={() => setDark(!dark)} aria-label="테마 전환">{dark ? "☀" : "◐"}</button>
        <button className="avatar" aria-label="개인 설정">JN</button>
      </div>
    </header>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("today");
  const [dark, setDark] = useState(true);
  const [items, setItems] = useState<Candidate[]>([]);
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("전체 소스");
  const [rejecting, setRejecting] = useState(false);
  const [rejectCategory, setRejectCategory] = useState<RejectionReasonCategory | "">("");
  const [rejectNote, setRejectNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [verifyingId, setVerifyingId] = useState("");
  const [visibilityNow, setVisibilityNow] = useState(() => Date.now());

  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);
  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const data = await response.json() as { candidates?: Candidate[]; logs?: RunLog[]; setupRequired?: boolean; error?: string };
      const nextItems = data.candidates ?? [];
      setItems(nextItems); setLogs(data.logs ?? []); setSetupRequired(Boolean(data.setupRequired));
      setDataError(response.ok ? "" : (data.error ?? "데이터를 불러오지 못했습니다."));
      setSelectedId(current => nextItems.some(item => item.id === current) ? current : (nextItems.find(item => !item.hiddenFromToday)?.id ?? nextItems[0]?.id ?? ""));
    } catch { setDataError("서버에 연결하지 못했습니다."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);
  useEffect(() => {
    const timer = window.setInterval(() => setVisibilityNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const todayItems = useMemo(() => items.filter(item =>
    !shouldHideRejectedFromToday(item.decision, item.decidedAt, visibilityNow)
  ), [items, visibilityNow]);
  const visible = useMemo(() => todayItems.filter(item =>
    (sourceFilter === "전체 소스" || item.source === sourceFilter) &&
    (item.summary.includes(search) || item.domain.includes(search) || item.who.includes(search))
  ), [todayItems, search, sourceFilter]);
  const selected = items.find(i => i.id === selectedId) ?? todayItems[0] ?? items[0];

  const verifyCandidate = useCallback(async (painPointId: string) => {
    if (!painPointId || verifyingId) return;
    setVerifyingId(painPointId);
    try {
      const response = await fetch("/api/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ painPointId }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "정밀 검증에 실패했습니다.");
      await loadDashboard();
    } catch (error) { setDataError(error instanceof Error ? error.message : "정밀 검증에 실패했습니다."); }
    finally { setVerifyingId(""); }
  }, [loadDashboard, verifyingId]);

  const decide = useCallback(async (decision: Decision, reasonCategory?: RejectionReasonCategory, reasonNote?: string) => {
    if (!selectedId) return;
    try {
      const response = await fetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ painPointId: selectedId, action: decision, reasonCategory, reasonNote }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "판정을 저장하지 못했습니다.");
      const reasonLabel = reasonCategory ? REJECTION_REASON_LABELS[reasonCategory] : null;
      const decidedAt = new Date().toISOString();
      setItems(prev => prev.map(item => item.id === selectedId ? {
        ...item,
        decision,
        decisionReason: reasonLabel ? `${reasonLabel}${reasonNote?.trim() ? ` · ${reasonNote.trim()}` : ""}` : null,
        decisionReasonCategory: reasonCategory ?? null,
        decidedAt,
        hiddenFromToday: false,
        recentlyRejected: isRecentlyRejected(decision, decidedAt),
      } : item));
      setRejecting(false); setRejectCategory(""); setRejectNote("");
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "판정을 저장하지 못했습니다.");
    }
  }, [selectedId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (view !== "today" || ["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement).tagName)) return;
      const index = visible.findIndex(i => i.id === selectedId);
      if (event.key.toLowerCase() === "j") setSelectedId(visible[Math.min(index + 1, visible.length - 1)]?.id ?? selectedId);
      if (event.key.toLowerCase() === "k") setSelectedId(visible[Math.max(index - 1, 0)]?.id ?? selectedId);
      if (event.key.toLowerCase() === "t") void decide("tracking");
      if (event.key.toLowerCase() === "h") void decide("holding");
      if (event.key.toLowerCase() === "x") setRejecting(true);
      if (event.key.toLowerCase() === "v" && selected?.id) void verifyCandidate(selected.id);
      if (event.key === "Enter" && selected?.url) window.open(selected.url, "_blank", "noopener,noreferrer");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, visible, selectedId, selected?.id, selected?.url, verifyCandidate, decide]);

  const titles: Record<View, [string, string]> = {
    today: ["오늘의 후보", "경쟁 검증을 통과한 신호부터 검토하세요."],
    signals: ["반복 신호", "서로 다른 시점과 출처에서 다시 나타난 문제입니다."],
    discovery: ["검색어 발굴", "수집 데이터와 업종 사전에서 후보를 찾고, 승인한 표현만 시드로 보냅니다."],
    settings: ["실행 설정", "검색어, 수집 소스, 비용 상한을 정하고 바로 실행합니다."],
    archive: ["보류함", "판단 기준이 바뀌면 언제든 다시 검토할 수 있습니다."],
    logs: ["실행 로그", "어디서 걸러졌고 왜 멈췄는지 숨김없이 보여줍니다."],
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("today")} aria-label="Painfinder 홈"><span className="brand-mark">P</span><span>PAIN<strong>FINDER</strong><small>RESEARCH CONSOLE</small></span></button>
        <nav aria-label="주요 메뉴">
          {NAV.map(n => { const count = n.id === "today" ? todayItems.length : n.id === "signals" ? todayItems.filter(i => i.recurrence >= 2).length : n.id === "archive" ? items.filter(i => i.decision === "holding" || i.decision === "rejected").length : 0; return <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => setView(n.id)}><b>{n.mark}</b><span>{n.label}</span>{count > 0 && <em>{count}</em>}</button>; })}
        </nav>
        <div className="sidebar-run">
          <div><span>오늘의 후보</span><strong>{todayItems.length}건</strong></div>
          <div className="meter"><i style={{ width: todayItems.length ? "100%" : "0%" }} /></div>
          <button onClick={() => setView("settings")}><span>▶</span> 지금 실행</button>
        </div>
        <div className="shortcut-legend"><p>KEYBOARD</p><div><kbd>J</kbd><kbd>K</kbd><span>이동</span></div><div><kbd>T</kbd><span>추적</span><kbd>H</kbd><span>보류</span></div><div><kbd>X</kbd><span>기각</span><kbd>V</kbd><span>검증</span></div><div><kbd>↵</kbd><span>원문</span></div></div>
      </aside>

      <section className="workspace">
        <Topbar title={titles[view][0]} subtitle={titles[view][1]} dark={dark} setDark={setDark} />
        {view === "today" && (selected ? <TodayView allItems={todayItems} visible={visible} selected={selected} lastRun={logs[0]} setSelectedId={setSelectedId} search={search} setSearch={setSearch} sourceFilter={sourceFilter} setSourceFilter={setSourceFilter} onDecision={decide} onVerify={verifyCandidate} verifyingId={verifyingId} rejecting={rejecting} setRejecting={setRejecting} rejectCategory={rejectCategory} setRejectCategory={setRejectCategory} rejectNote={rejectNote} setRejectNote={setRejectNote} /> : <DashboardEmpty loading={loading} error={dataError} setupRequired={setupRequired} onSettings={() => setView("settings")} onRetry={loadDashboard} />)}
        {view === "signals" && <SignalsView items={todayItems} onOpen={(id) => { setSelectedId(id); setView("today"); }} />}
        {view === "discovery" && <DiscoveryView />}
        {view === "settings" && <SettingsView onRunComplete={loadDashboard} />}
        {view === "archive" && <ArchiveView items={items} onRestore={(id) => { setSelectedId(id); setView("today"); }} />}
        {view === "logs" && <LogsView runs={logs} />}
      </section>

      <nav className="mobile-nav" aria-label="모바일 메뉴">{NAV.map(n => <button key={n.id} onClick={() => setView(n.id)} className={view === n.id ? "active" : ""}><b>{n.mark}</b><span>{n.label.replace("오늘의 ", "")}</span></button>)}</nav>
    </main>
  );
}

function TodayView({ allItems, visible, selected, lastRun, setSelectedId, search, setSearch, sourceFilter, setSourceFilter, onDecision, onVerify, verifyingId, rejecting, setRejecting, rejectCategory, setRejectCategory, rejectNote, setRejectNote }: {
  allItems: Candidate[]; visible: Candidate[]; selected: Candidate; lastRun?: RunLog; setSelectedId: (id: string) => void; search: string; setSearch: (v: string) => void; sourceFilter: string; setSourceFilter: (v: string) => void; onDecision: (d: Decision, reasonCategory?: RejectionReasonCategory, reasonNote?: string) => Promise<void>; onVerify: (id: string) => Promise<void>; verifyingId: string; rejecting: boolean; setRejecting: (v: boolean) => void; rejectCategory: RejectionReasonCategory | ""; setRejectCategory: (v: RejectionReasonCategory | "") => void; rejectNote: string; setRejectNote: (v: string) => void;
}) {
  const rejected = allItems.filter(item => item.decision === "rejected").length;
  return <div className="today-layout">
    <section className="candidate-pane">
      <div className="stat-strip">
        <div><span>전체 후보</span><strong>{allItems.length}</strong><small>실제 축적 데이터</small></div>
        <div><span>정밀 검증 대기</span><strong>{allItems.filter(i => !i.precisionVerified).length}</strong><small>시장 상태 미확인</small></div>
        <div><span>반복 신호</span><strong>{allItems.filter(i => i.recurrence >= 2).length}</strong><small className="good">2회 이상</small></div>
        <div><span>기각률</span><strong>{allItems.length ? Math.round(rejected / allItems.length * 100) : 0}%</strong><small>전체 판정 기준</small></div>
      </div>
      <div className="filter-row">
        <label className="searchbox"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="후보 검색" /></label>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} aria-label="소스 필터"><option>전체 소스</option><option>네이버 카페</option><option>지식iN</option><option>네이버 블로그</option><option>앱 리뷰</option><option>Threads</option></select>
        <button className="export-button" onClick={() => downloadCandidatesText(allItems)} disabled={!allItems.length} title="클로드 공유용 TXT 파일로 저장">전체 TXT ↓</button>
      </div>
      <div className="list-head"><span>후보 {visible.length}건</span><small>최근 실행 · {lastRun ? new Date(lastRun.startedAt).toLocaleString("ko-KR") : "없음"}</small></div>
      <div className="candidate-list">
        {visible.map(item => <button key={item.id} className={`candidate-row ${selected.id === item.id ? "selected" : ""} ${item.recentlyRejected ? "recently-rejected" : ""}`} onClick={() => setSelectedId(item.id)}>
          <div className="row-status"><i className={`status-dot ${item.decision}`} /><ScoreGauge score={item.score} max={item.scoreMax} /></div>
          <div className="row-main"><h3>{item.summary}</h3><div><span className={`source-tag ${item.sourceTone}`}>{item.source}</span><span>{item.domain}</span><span>{item.time}</span>{item.recurrence >= 3 && <span className="repeat-tag">↻ {item.recurrence}회 반복</span>}</div></div>
          <div className={`market-badge ${item.marketVerdict}`}>{marketLabel(item)}</div>
          <span className={`status-label ${item.decision}`}>{STATUS_LABEL[item.decision]}</span>
        </button>)}
        {visible.length === 0 && <div className="empty">조건에 맞는 후보가 없습니다.</div>}
      </div>
    </section>

    <aside className="detail-pane">
      <div className="detail-scroll">
        <div className="detail-kicker"><span className={`source-tag ${selected.sourceTone}`}>{selected.source}</span>{selected.sourceName && <span>{selected.sourceName}</span>}<span>{selected.time}</span><span>ID · PF-{String(selected.id).padStart(4, "0")}</span></div>
        <div className="detail-title"><div><h2>{selected.summary}</h2><p>{selected.who} · {selected.frequency} 발생</p></div><ScoreGauge score={selected.score} max={selected.scoreMax} /></div>
        <section className="detail-section original">
          <header><h3>원문 스니펫 전문</h3><div className="original-links"><a href={selected.url} target="_blank" rel="noreferrer">원문 보기 ↗</a><a href={selected.naverSearchUrl} target="_blank" rel="noreferrer">네이버에서 검색 ↗</a></div></header>
          <div className="snippet-meta"><span>{selected.bodyLength}자</span>{selected.postedAt && <time>게시일 {new Date(selected.postedAt).toLocaleDateString("ko-KR")}</time>}{selected.isCafe && <span className="join-warning">카페 가입이 필요할 수 있음</span>}</div>
          {selected.isPromotional && <div className="promotion-warning"><strong>광고 의심</strong><span>자동 광고 판정 신호가 있어 사람이 다시 검토해야 합니다.</span></div>}
          {!selected.isPromotional && selected.promotionalRuleFlagged && <div className="promotion-signal"><strong>광고 신호 감지</strong><span>룰 신호는 있었지만 LLM은 현재 페인포인트로 판정했습니다. 원문을 직접 확인하세요.</span></div>}
          {selected.lowConfidence && <div className="confidence-warning"><strong>판단 재료 부족</strong><span>스니펫이 40자 미만이라 판정 신뢰도가 낮습니다.</span></div>}
          <blockquote>“<HighlightText text={selected.excerpt} terms={selected.highlightTerms} />”</blockquote>
        </section>
        <section className="detail-section analysis"><header><h3>LLM 분석</h3><span>구조화 분석 완료</span></header><dl><div><dt>누가</dt><dd>{selected.who}</dd></div><div><dt>무엇을</dt><dd>{selected.summary}</dd></div><div><dt>어떻게 때우는가</dt><dd>{selected.workaround}</dd></div><div><dt>빈도</dt><dd><span className="amber-text">{selected.frequency}</span> · {selected.signal}</dd></div><div><dt>지불 신호</dt><dd>{selected.money ? `“${selected.money}”` : <span className="muted">명시적 신호 없음</span>}</dd></div></dl></section>
        <section className="detail-section competitors"><header><h3>경쟁 검증 <b>{selected.precisionVerified ? selected.rivals.length : "—"}</b></h3><span className={`market-badge ${selected.marketVerdict}`}>{marketLabel(selected)}</span></header>
          <div className={`precision-status ${selected.precisionVerified ? "done" : "pending"}`}><div><strong>{selected.precisionVerified ? "정밀 검증 완료" : "미검증"}</strong><small>{selected.precisionVerified ? "앱 마켓과 제품 페이지를 함께 확인했습니다." : "아직 제품 경쟁자를 정밀 검색하지 않았습니다. 경쟁 상태는 알 수 없습니다."}</small></div><button onClick={() => void onVerify(selected.id)} disabled={Boolean(verifyingId)}>{verifyingId === selected.id ? <><i className="verify-spinner" /> 검증 중</> : <><kbd>V</kbd> {selected.precisionVerified ? "다시 검증" : "정밀 검증 실행"}</>}</button></div>
          {selected.precisionVerified && selected.rivals.length ? <div className="rival-list">{selected.rivals.map(r => <a key={r.url || r.name} href={r.url} target="_blank" rel="noreferrer"><i className={`rival-state ${r.state}`} /> <strong>{r.name}</strong><span className={`pricing-badge ${r.pricing}`}>{PRICING_LABEL[r.pricing]}</span><p>{r.note}{r.seller ? ` · ${r.seller}` : ""}</p><em>↗</em></a>)}</div> : selected.precisionVerified ? <div className="zero-rivals"><strong>검증 결과, 제품 경쟁자가 0개입니다.</strong><p>자동 합격이 아닙니다. 수요가 형성되지 않은 시장일 수 있는 경계 상태입니다.</p></div> : <div className="zero-rivals unverified"><strong>아직 경쟁자를 찾아보지 않았습니다.</strong><p>정밀 검증을 실행하기 전에는 경쟁자 유무를 판정하지 않습니다.</p></div>}
        </section>
        <section className="detail-section scorecard"><header><h3>4개 필터</h3><span>{selected.score} / {selected.scoreMax}점{selected.precisionVerified ? (selected.scoreMax === 12 ? " · 기존 기록" : "") : " · 인컴번트 미포함"}</span></header><div className="score-grid">{selected.scores.map(s => <div key={s.label} className={s.value === null ? "score-unverified" : ""}><span>{s.label}</span><div className="score-track"><i style={{ width: `${s.value === null ? 0 : s.max ? s.value / s.max * 100 : 0}%` }} /></div><b>{s.value === null ? "—" : s.value}</b></div>)}</div><div className={`access-flag ${selected.access ? "stable" : "unstable"}`}><span>{selected.access ? "✓" : "!"}</span><div><strong>데이터 접근 {selected.access ? "안정" : "불안정"}</strong><small>{selected.access ? "공식 API 또는 공개 데이터 확인" : "공식 API가 없어 별도 검토 필요"}</small></div></div></section>
      </div>
      <div className="decision-bar">
        {rejecting ? <div className="reject-form">
          <strong>기각 사유</strong>
          <div className="reject-reasons">{Object.entries(REJECTION_REASON_LABELS).map(([value, label]) => <label key={value} className={rejectCategory === value ? "selected" : ""}><input type="radio" name="reject-category" value={value} checked={rejectCategory === value} onChange={() => setRejectCategory(value as RejectionReasonCategory)} /><span>{label}{value === "not_painpoint" && <small>명백한 오탐만 안전 키워드 자동 반영</small>}{value === "promotional" && <small>제품명·유도어 자동 반영</small>}{value === "out_of_interest" && <small>제외 도메인 승인 제안</small>}{value === "already_solved" && <small>통계만 집계 · 필터 반영 안 함</small>}</span></label>)}</div>
          <textarea value={rejectNote} onChange={event => setRejectNote(event.target.value)} placeholder={rejectCategory === "other" ? "기타 사유를 입력하세요" : "자유 메모 (선택)"} />
          <div><button className="confirm-reject" onClick={() => void onDecision("rejected", rejectCategory || undefined, rejectNote)} disabled={!rejectCategory || (rejectCategory === "other" && !rejectNote.trim())}>기각 확정</button><button onClick={() => { setRejecting(false); setRejectCategory(""); setRejectNote(""); }}>취소</button></div>
        </div> : <><button className="track" onClick={() => void onDecision("tracking")}><kbd>T</kbd> 추적</button><button onClick={() => void onDecision("holding")}><kbd>H</kbd> 보류</button><button className="reject" onClick={() => setRejecting(true)}><kbd>X</kbd> 기각</button></>}
      </div>
    </aside>
  </div>;
}

function DashboardEmpty({ loading, error, setupRequired, onSettings, onRetry }: { loading: boolean; error: string; setupRequired: boolean; onSettings: () => void; onRetry: () => void }) {
  return <div className="dashboard-empty"><div className="empty-index">00</div><p className="eyebrow">FIRST RUN</p><h2>{loading ? "실제 데이터를 불러오는 중입니다" : setupRequired ? "먼저 Supabase 스키마를 적용하세요" : "아직 수집된 후보가 없습니다"}</h2><p>{loading ? "잠시만 기다려 주세요." : error ? "데이터베이스 연결을 확인한 뒤 다시 시도하세요." : "실행 설정에서 검색어와 소스를 정한 다음 첫 수집을 실행하세요."}</p>{!loading && <div className="empty-steps"><div><b>01</b><span>Supabase에서 schema.sql 실행</span></div><div><b>02</b><span>검색어를 직접 입력하고 소스 선택</span></div><div><b>03</b><span>설정 저장 후 지금 실행</span></div><div><b>04</b><span>후보를 추적·보류·기각</span></div></div>}<div className="empty-actions"><button onClick={onSettings}>실행 설정 열기 →</button><button onClick={onRetry}>새로고침</button></div></div>;
}

function SignalsView({ items, onOpen }: { items: Candidate[]; onOpen: (id: string) => void }) {
  const clusters = items.filter(item => item.recurrence >= 2).sort((a, b) => b.recurrence - a.recurrence);
  return <div className="page-pad"><div className="signal-toolbar"><div className="insight"><span>↻</span><div><strong>반복은 의견보다 강합니다.</strong><p>다른 시점이나 출처에서 같은 문제가 확인되면 여기에 표시됩니다.</p></div></div><button>카운트 높은 순 ↕</button></div>{clusters.length ? <div className="cluster-list">{clusters.map((c, idx) => <button key={c.id} className="cluster" onClick={() => onOpen(c.id)}><div className="cluster-rank">{String(idx + 1).padStart(2, "0")}</div><div className="cluster-copy"><div><span className="cluster-count">{c.recurrence}회 반복</span><span>{c.time}</span></div><h2>{c.summary}</h2><p>{c.who} · {c.domain}</p><div className="cluster-sources"><i>{c.source}</i></div></div><span className="cluster-arrow">→</span></button>)}</div> : <div className="section-empty"><strong>반복 신호가 아직 없습니다.</strong><p>같은 문제의 신호가 2회 이상 축적되면 자동으로 나타납니다.</p></div>}</div>;
}

type DiscoveryItem = { id: number; origin: "cafe" | "text_mining" | "industry"; term: string; category: string; source_ref: string; frequency: number };
type CafeStat = { cafeId: string; cafeName: string | null; collected: number; passed: number; passRate: number };
type IndustryTranslation = { roles?: string[]; tools?: string[]; tasks?: string[] };
type IndustrySeed = { id: number; ksic_code: string; ksic_name: string; section: string | null; active: boolean; note: string | null; done: boolean; translation: IndustryTranslation | null; translated_at: string | null };
type DiscoveryData = { cafes: CafeStat[]; insufficientCafes: CafeStat[]; discoveries: DiscoveryItem[]; industries: IndustrySeed[]; seeds: Array<{ id: number; query_text: string; origin: string; active: boolean; last_used_at: string | null }>; error?: string };
type LearningSuggestion = { id: number; suggestion_type: "keyword" | "promotional_keyword" | "domain" | "prompt_example"; value: string; evidence_count: number; status: "pending" | "approved" | "dismissed"; created_at: string };
type FilterAddition = { id: number; keyword: string; kind: "keyword" | "domain"; source_reason: string; mode: "auto" | "approved"; added_at: string; active: boolean; revoked_at: string | null };
type LearningData = {
  minEvidence: number;
  suggestions: LearningSuggestion[];
  exclusions: Array<{ id: number; kind: "keyword" | "domain"; value: string; created_at: string; active: boolean }>;
  filterAdditions: FilterAddition[];
  stats: {
    decisionCounts: { tracking?: number; holding?: number; rejected?: number };
    reasonDistribution: Array<{ label: string; count: number }>;
    originStats: Array<{ origin: string; decided: number; tracking: number; trackingRate: number }>;
    trackingProfile: { topDomain: { label: string; count: number } | null; topVerdict: { label: string; count: number } | null; topScoreBand: { label: string; count: number } | null };
    promptExampleCount: number;
  };
  error?: string;
};

const DISCOVERY_CATEGORY: Record<string, string> = {
  cafe_focus: "집중 수집어", tools: "도구", tasks: "업무", jargon: "현업 표현", roles: "직군",
};

const KSIC_SECTION_LABELS: Record<string, string> = {
  G: "도소매", H: "운수·창고", I: "숙박·음식", J: "정보통신", K: "금융·보험", L: "부동산",
  M: "전문·과학·기술", N: "사업지원·임대", P: "교육", Q: "보건·복지", R: "예술·스포츠", S: "개인 서비스",
  CUSTOM: "카페 입력",
};

function DiscoveryView() {
  const [tab, setTab] = useState<"cafe" | "text_mining" | "industry" | "learning">("cafe");
  const [data, setData] = useState<DiscoveryData>({ cafes: [], insufficientCafes: [], discoveries: [], industries: [], seeds: [] });
  const [selected, setSelected] = useState<number[]>([]);
  const [industrySelected, setIndustrySelected] = useState<number[]>([]);
  const [industrySearch, setIndustrySearch] = useState("");
  const [industrySection, setIndustrySection] = useState("ALL");
  const [industrySort, setIndustrySort] = useState<"pending" | "section">("pending");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/discovery", { cache: "no-store" });
      const payload = await response.json() as DiscoveryData;
      if (!response.ok) throw new Error(payload.error ?? "검색어 발굴 데이터를 불러오지 못했습니다.");
      setData(payload);
      setIndustrySelected(current => current.filter(id => payload.industries.some(industry => industry.id === id && !industry.done)));
    } catch (error) { setMessage(error instanceof Error ? error.message : "검색어 발굴 데이터를 불러오지 못했습니다."); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const runAction = async (action: string, extra: Record<string, unknown> = {}) => {
    if (busy) return;
    setBusy(action); setMessage("");
    try {
      const response = await fetch("/api/discovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const result = await response.json() as { error?: string; added?: number; created?: number; translated?: number; calls?: number };
      if (!response.ok) throw new Error(result.error ?? "작업에 실패했습니다.");
      if (action === "approve") { setMessage(tab === "industry" ? `${result.added ?? 0}개 검색어를 시드에 추가했습니다. 업종 출처 시드는 자동 실행에서 제외됩니다.` : `${result.added ?? 0}개 검색어를 시드에 추가했습니다.`); setSelected([]); }
      if (action === "cafe-focus") setMessage(`${result.created ?? 0}개 집중 수집어를 만들었습니다. 아래에서 승인할 항목을 고르세요.`);
      if (action === "cafe-to-industry") { setMessage("카페 이름을 업종 번역 대기열에 보냈습니다."); setTab("industry"); }
      if (action === "mine-text") setMessage(`${result.calls ?? 0}회 배치 호출로 ${result.created ?? 0}개 원문 어휘를 찾았습니다.`);
      if (action === "translate-industries") { setMessage(`${result.translated ?? 0}개 업종을 ${result.calls ?? 0}회 호출로 번역했습니다.`); setIndustrySelected([]); }
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "작업에 실패했습니다."); }
    finally { setBusy(""); }
  };

  const candidates = tab === "learning" ? [] : data.discoveries.filter(item => item.origin === tab);
  const toggle = (id: number) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const selectAll = () => setSelected(current => {
    const other = current.filter(id => !candidates.some(item => item.id === id));
    return candidates.every(item => current.includes(item.id)) ? other : [...other, ...candidates.map(item => item.id)];
  });
  const activeIndustries = data.industries.filter(industry => industry.active);
  const pendingIndustries = activeIndustries.filter(industry => !industry.done);
  const completedIndustries = data.industries.filter(industry => industry.done);
  const visibleIndustries = activeIndustries
    .filter(industry => industrySection === "ALL" || industry.section === industrySection)
    .filter(industry => !industrySearch.trim() || industry.ksic_name.toLocaleLowerCase("ko-KR").includes(industrySearch.trim().toLocaleLowerCase("ko-KR")))
    .sort((a, b) => {
      if (industrySort === "pending" && a.done !== b.done) return a.done ? 1 : -1;
      return String(a.section).localeCompare(String(b.section)) || a.ksic_code.localeCompare(b.ksic_code);
    });
  const toggleIndustry = (id: number) => setIndustrySelected(current => {
    if (current.includes(id)) return current.filter(value => value !== id);
    if (current.length >= 20) { setMessage("업종은 한 번에 최대 20개까지 선택할 수 있습니다."); return current; }
    return [...current, id];
  });

  return <div className="discovery-page">
    <div className="discovery-summary">
      <div><span>승인된 시드</span><strong>{data.seeds.length}</strong><small>오래 안 쓴 순으로 실행</small></div>
      <div><span>카페 금맥</span><strong>{data.cafes.length}</strong><small>기존 수집 URL 집계</small></div>
      <div><span>승인 대기</span><strong>{data.discoveries.length}</strong><small>자동 실행 없음</small></div>
      <div><span>업종 진행</span><strong>{completedIndustries.length}/{data.industries.length}</strong><small>버튼 실행만 번역</small></div>
    </div>
    <div className="discovery-tabs" role="tablist" aria-label="검색어 발굴 방식">
      <button role="tab" aria-selected={tab === "cafe"} className={tab === "cafe" ? "active" : ""} onClick={() => setTab("cafe")}><b>A</b><span>카페 금맥<small>기존 데이터 역채굴</small></span></button>
      <button role="tab" aria-selected={tab === "text_mining"} className={tab === "text_mining" ? "active" : ""} onClick={() => setTab("text_mining")}><b>B</b><span>원문 어휘<small>통과 글 표현 추출</small></span></button>
      <button role="tab" aria-selected={tab === "industry"} className={tab === "industry" ? "active" : ""} onClick={() => setTab("industry")}><b>C</b><span>업종 사전<small>KSIC → 현업 어휘</small></span></button>
      <button role="tab" aria-selected={tab === "learning"} className={tab === "learning" ? "active" : ""} onClick={() => setTab("learning")}><b>D</b><span>학습 제안<small>거부 사유 → 승인형 룰</small></span></button>
    </div>

    {message && <div className="discovery-message" role="status">{message}</div>}

    {tab === "cafe" && <section className="discovery-panel">
      <header><div><span>AXIS A</span><h2>통과 건수가 많은 카페부터 넓히기</h2><p>표본 5건 이상만 메인 랭킹에 표시하며, 통과 건수 → 통과율 순으로 정렬합니다. 집중 수집은 승인 전까지 실행되지 않습니다.</p></div></header>
      <div className="cafe-table">
        <div className="cafe-head"><span>카페 ID</span><span>카페명</span><span>수집</span><span>통과</span><span>통과율</span><span>활용</span></div>
        {data.cafes.map(cafe => <div className="cafe-row" key={cafe.cafeId}><strong>{cafe.cafeId}</strong><span>{cafe.cafeName ?? cafe.cafeId}</span><b>{cafe.collected}</b><b>{cafe.passed}</b><div><i style={{ width: `${Math.round(cafe.passRate * 100)}%` }} /><em>{(cafe.passRate * 100).toFixed(1)}%</em></div><div><button onClick={() => void runAction("cafe-focus", { cafeId: cafe.cafeId })} disabled={Boolean(busy)}>{busy === "cafe-focus" ? "생성 중" : "이 카페 집중 수집"}</button><button className="link-button" onClick={() => void runAction("cafe-to-industry", { cafeId: cafe.cafeId })} disabled={Boolean(busy)}>업종 번역으로 →</button></div></div>)}
        {!data.cafes.length && <div className="discovery-empty">표본 5건 이상인 네이버 카페가 없습니다.</div>}
      </div>
      <details className="insufficient-cafes">
        <summary>표본 부족 · 수집 5건 미만 <b>{data.insufficientCafes.length}</b></summary>
        <div className="cafe-table">
          <div className="cafe-head compact"><span>카페 ID</span><span>표시명</span><span>수집</span><span>통과</span><span>통과율</span><span>상태</span></div>
          {data.insufficientCafes.map(cafe => <div className="cafe-row compact" key={cafe.cafeId}><strong>{cafe.cafeId}</strong><span>{cafe.cafeName ?? cafe.cafeId}</span><b>{cafe.collected}</b><b>{cafe.passed}</b><div><i style={{ width: `${Math.round(cafe.passRate * 100)}%` }} /><em>{(cafe.passRate * 100).toFixed(1)}%</em></div><span className="sample-badge">표본 부족</span></div>)}
        </div>
      </details>
      <CandidateApproval items={candidates} selected={selected} toggle={toggle} selectAll={selectAll} onApprove={() => void runAction("approve", { ids: selected.filter(id => candidates.some(item => item.id === id)) })} busy={busy} />
    </section>}

    {tab === "text_mining" && <section className="discovery-panel">
      <header className="action-header"><div><span>AXIS B</span><h2>통과 원문에서 실제 표현 찾기</h2><p>최근 1차 통과 원문의 제목과 본문을 한 번의 배치 호출로 분석하고, 실제 등장 빈도를 다시 계산합니다.</p></div><button onClick={() => void runAction("mine-text")} disabled={Boolean(busy)}>{busy === "mine-text" ? "추출 중…" : "원문 어휘 추출 · 1회"}</button></header>
      <CandidateApproval items={candidates} selected={selected} toggle={toggle} selectAll={selectAll} onApprove={() => void runAction("approve", { ids: selected.filter(id => candidates.some(item => item.id === id)) })} busy={busy} />
    </section>}

    {tab === "industry" && <section className="discovery-panel">
      <header className="action-header"><div><span>AXIS C</span><h2>서비스업을 골라 현업 어휘로 번역하기</h2><p>활성 서비스업만 표시합니다. 관심 업종을 직접 선택하며, 소프트웨어로 해결 가능한 관리·사무·거래 어휘만 후보로 남깁니다.</p></div><button onClick={() => void runAction("translate-industries", { industryIds: industrySelected })} disabled={Boolean(busy) || !industrySelected.length}>{busy === "translate-industries" ? "번역 중…" : `선택 ${industrySelected.length}개 번역`}</button></header>
      <div className="industry-browser">
        <div className="industry-tools">
          <label><span>업종 검색</span><input type="search" value={industrySearch} onChange={event => setIndustrySearch(event.target.value)} placeholder="영상, 미용, 학원…" /></label>
          <label><span>정렬</span><select value={industrySort} onChange={event => setIndustrySort(event.target.value as "pending" | "section")}><option value="pending">미처리 우선</option><option value="section">대분류순</option></select></label>
          <strong>{visibleIndustries.length}개 표시 · {pendingIndustries.length}개 미처리</strong>
        </div>
        <div className="industry-chips" aria-label="KSIC 대분류 필터">
          <button className={industrySection === "ALL" ? "active" : ""} onClick={() => setIndustrySection("ALL")}>전체</button>
          {Object.entries(KSIC_SECTION_LABELS).map(([code, label]) => <button key={code} className={industrySection === code ? "active" : ""} onClick={() => setIndustrySection(code)}><b>{code === "CUSTOM" ? "+" : code}</b>{label}</button>)}
        </div>
        <div className="industry-list">
          {visibleIndustries.map(industry => <div className={`industry-row ${industry.done ? "done" : ""}`} key={industry.id}>
            <label><input type="checkbox" checked={industrySelected.includes(industry.id)} onChange={() => toggleIndustry(industry.id)} disabled={industry.done || Boolean(busy)} /><span className="section-code">{industry.section === "CUSTOM" ? "+" : industry.section}</span><b>{industry.ksic_code}</b><strong>{industry.ksic_name}</strong><em>{industry.done ? "완료" : "미처리"}</em></label>
            {industry.done && industry.translation && <details><summary>번역 결과 보기</summary><div>{(["roles", "tools", "tasks"] as const).map(category => <section key={category}><b>{DISCOVERY_CATEGORY[category]}</b><p>{industry.translation?.[category]?.join(" · ") || "결과 없음"}</p></section>)}</div></details>}
          </div>)}
          {!visibleIndustries.length && <div className="discovery-empty">조건에 맞는 활성 서비스업이 없습니다.</div>}
        </div>
      </div>
      <CandidateApproval items={candidates} selected={selected} toggle={toggle} selectAll={selectAll} onApprove={() => void runAction("approve", { ids: selected.filter(id => candidates.some(item => item.id === id)) })} busy={busy} />
    </section>}

    {tab === "learning" && <LearningPanel />}
  </div>;
}

function LearningPanel() {
  const [data, setData] = useState<LearningData | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/learning", { cache: "no-store" });
      const payload = await response.json() as LearningData;
      if (!response.ok) throw new Error(payload.error ?? "학습 데이터를 불러오지 못했습니다.");
      setData(payload);
      setSelected(current => current.filter(id => payload.suggestions.some(item => item.id === id && item.status === "pending")));
    } catch (error) { setMessage(error instanceof Error ? error.message : "학습 데이터를 불러오지 못했습니다."); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (!data) return <section className="discovery-panel"><div className="discovery-empty">{message || "학습 통계를 불러오는 중입니다."}</div></section>;
  const pending = data.suggestions.filter(item => item.status === "pending" && item.suggestion_type !== "prompt_example");
  const promptExamples = data.suggestions.filter(item => item.suggestion_type === "prompt_example");
  const maxReason = Math.max(1, ...data.stats.reasonDistribution.map(item => item.count));
  const originLabel: Record<string, string> = { manual: "수동", cafe: "카페", text_mining: "원문 채굴", industry: "업종", unknown: "기존/미상" };
  const verdictValue = data.stats.trackingProfile.topVerdict?.label;
  const verdictLabel = verdictValue && verdictValue in MARKET_LABEL
    ? MARKET_LABEL[verdictValue as MarketVerdict]
    : "데이터 부족";

  const approve = async () => {
    if (!selected.length || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve", ids: selected }) });
      const result = await response.json() as { approved?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "학습 제안을 승인하지 못했습니다.");
      setMessage(`${result.approved ?? 0}개 제외 룰을 승인했습니다. 다음 저장부터 적용됩니다.`);
      setSelected([]);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "학습 제안을 승인하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const revokeFilter = async (filterAdditionId: number) => {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "revoke-filter", filterAdditionId }) });
      const result = await response.json() as { revoked?: boolean; error?: string };
      if (!response.ok || !result.revoked) throw new Error(result.error ?? "필터 취소에 실패했습니다.");
      setMessage("필터 반영을 취소했습니다. 다음 실행부터 적용되지 않습니다.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "필터 취소에 실패했습니다."); }
    finally { setBusy(false); }
  };

  return <section className="discovery-panel learning-panel">
    <header><div><span>SAFE LEARNING</span><h2>기각 사유를 안전한 필터로 되먹이기</h2><p>명백한 오탐·광고만 일반어를 제거한 뒤 자동 반영합니다. 관심 밖 분야는 기존처럼 제안에 쌓이고, 승인 전에는 적용되지 않습니다.</p></div></header>
    {message && <div className="discovery-message" role="status">{message}</div>}
    <div className="learning-metrics">
      <div><span>추적</span><strong>{data.stats.decisionCounts.tracking ?? 0}</strong></div>
      <div><span>보류</span><strong>{data.stats.decisionCounts.holding ?? 0}</strong></div>
      <div><span>기각</span><strong>{data.stats.decisionCounts.rejected ?? 0}</strong></div>
      <div><span>프롬프트 개선 예시</span><strong>{data.stats.promptExampleCount}</strong></div>
    </div>
    <div className="learning-grid">
      <section className="learning-card"><header><h3>기각 사유 분포</h3><small>최신 판정 기준</small></header><div className="reason-bars">{data.stats.reasonDistribution.map(item => <div key={item.label}><span>{item.label}</span><i><b style={{ width: `${item.count / maxReason * 100}%` }} /></i><strong>{item.count}</strong></div>)}{!data.stats.reasonDistribution.length && <p>기각 판정이 아직 없습니다.</p>}</div></section>
      <section className="learning-card"><header><h3>origin별 추적률</h3><small>어느 발굴 축이 추적으로 이어졌는지</small></header><div className="origin-table">{data.stats.originStats.map(item => <div key={item.origin}><span>{originLabel[item.origin] ?? item.origin}</span><b>{item.tracking}/{item.decided}</b><strong>{Math.round(item.trackingRate * 100)}%</strong></div>)}{!data.stats.originStats.length && <p>판정 데이터가 아직 없습니다.</p>}</div></section>
      <section className="learning-card tracking-profile"><header><h3>추적 후보 공통 특징</h3><small>통계 전용 · 점수 자동 반영 없음</small></header><p>주요 분야 <strong>{data.stats.trackingProfile.topDomain?.label ?? "데이터 부족"}</strong></p><p>주요 시장 <strong>{verdictLabel}</strong></p><p>주요 점수대 <strong>{data.stats.trackingProfile.topScoreBand?.label ?? "데이터 부족"}</strong></p></section>
    </div>
    <div className="learning-approval">
      <div className="approval-head"><div><h3>룰 강화 제안</h3><span>근거 {data.minEvidence}회 이상만 승인 가능 · 승인 전 자동 반영 없음</span></div><button className="approve-button" onClick={() => void approve()} disabled={busy || !selected.length}>{busy ? "반영 중…" : `선택 ${selected.length}개 승인`}</button></div>
      <div className="learning-suggestions">{pending.map(item => {
        const canApprove = item.evidence_count >= data.minEvidence;
        return <label key={item.id} className={`${selected.includes(item.id) ? "selected" : ""} ${canApprove ? "" : "insufficient"}`}><input type="checkbox" checked={selected.includes(item.id)} disabled={!canApprove} onChange={() => setSelected(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])} /><span><strong>{item.value}</strong><small>{item.suggestion_type === "promotional_keyword" ? "광고 제품명 제외 후보" : item.suggestion_type === "keyword" ? "제외 키워드" : "제외 도메인"}</small></span><b>{item.evidence_count}회</b></label>;
      })}{!pending.length && <div className="discovery-empty">승인 대기 중인 룰 제안이 없습니다.</div>}</div>
    </div>
    <div className="filter-addition-history">
      <div className="approval-head"><div><h3>필터 반영 이력</h3><span>자동·승인 근거를 보존하며 언제든 다음 실행부터 취소 가능</span></div><b>{data.filterAdditions.filter(item => item.active).length}개 활성</b></div>
      <div>{data.filterAdditions.map(item => <article key={item.id} className={item.active ? "" : "revoked"}><span className={`filter-mode ${item.mode}`}>{item.mode === "auto" ? "자동 반영됨" : "승인 반영"}</span><div><strong>{item.keyword}</strong><small>{item.kind === "domain" ? "제외 도메인" : "제외 키워드"} · {REJECTION_REASON_LABELS[item.source_reason as RejectionReasonCategory] ?? item.source_reason} · {new Date(item.added_at).toLocaleDateString("ko-KR")}</small></div>{item.active ? <button onClick={() => void revokeFilter(item.id)} disabled={busy}>반영 취소</button> : <span className="revoked-label">취소됨</span>}</article>)}{!data.filterAdditions.length && <div className="discovery-empty">아직 필터 반영 이력이 없습니다.</div>}</div>
    </div>
    <details className="learning-history"><summary>룰 강화 이력 <b>{data.exclusions.length}</b></summary><div>{data.exclusions.map(item => <p key={item.id}><span>{item.kind === "keyword" ? "키워드" : "도메인"}</span><strong>{item.value}</strong><time>{new Date(item.created_at).toLocaleDateString("ko-KR")}</time></p>)}{!data.exclusions.length && <p>승인된 제외 룰이 없습니다.</p>}</div></details>
    <details className="learning-history"><summary>2차 분석 프롬프트 개선 예시 <b>{promptExamples.length}</b></summary><div>{promptExamples.slice(0, 30).map(item => <p key={item.id}><span>요약 오류</span><strong>{item.value}</strong><time>{item.evidence_count}회</time></p>)}{!promptExamples.length && <p>수집된 개선 예시가 없습니다.</p>}</div></details>
  </section>;
}

function CandidateApproval({ items, selected, toggle, selectAll, onApprove, busy }: { items: DiscoveryItem[]; selected: number[]; toggle: (id: number) => void; selectAll: () => void; onApprove: () => void; busy: string }) {
  const selectedCount = items.filter(item => selected.includes(item.id)).length;
  return <div className="approval-block">
    <div className="approval-head"><div><h3>검색어 후보</h3><span>{items.length}개 · 사람이 고른 항목만 시드에 추가</span></div><div><button className="select-all" onClick={selectAll} disabled={!items.length}>전체 선택</button><button className="approve-button" onClick={onApprove} disabled={!selectedCount || Boolean(busy)}>{busy === "approve" ? "추가 중…" : `선택 ${selectedCount}개 시드 추가`}</button></div></div>
    <div className="candidate-terms">{items.map(item => <label key={item.id} className={selected.includes(item.id) ? "selected" : ""}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} /><span><strong>{item.term}</strong><small>{DISCOVERY_CATEGORY[item.category] ?? item.category}{item.source_ref && item.origin !== "text_mining" ? ` · ${item.source_ref}` : ""}</small></span><b>{item.frequency}회</b></label>)}{!items.length && <div className="discovery-empty">아직 승인 대기 중인 후보가 없습니다.</div>}</div>
  </div>;
}

function SettingsView({ onRunComplete }: { onRunComplete: () => void }) {
  const [sources, setSources] = useState(["네이버카페", "지식iN", "블로그"]);
  const [sourceWeights, setSourceWeights] = useState({ kin: 35, blog: 30, cafearticle: 35 });
  const [queries, setQueries] = useState<string[]>([]);
  const [queryInput, setQueryInput] = useState("");
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState(false);
  const [runMessage, setRunMessage] = useState("");
  const [autoVerifyTopN, setAutoVerifyTopN] = useState(10);
  useEffect(() => {
    let active = true;
    void fetch("/api/seed-queries?limit=20", { cache: "no-store" }).then(response => response.json()).then((data: { seeds?: Array<{ query_text: string }> }) => {
      if (active) setQueries(current => current.length ? current : (data.seeds ?? []).map(seed => seed.query_text));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const configBody = () => ({
    name: "직접 검색",
    queries,
    sources: Object.fromEntries(sources.map(source => [source, true])),
    source_weights: sourceWeights,
    period_days: 7,
    auto_verify_top_n: autoVerifyTopN,
    limits: { queries: Math.min(Math.max(queries.length, 1), 20), itemsPerSource: 50, dailyCostUsd: 3 },
  });
  const startRun = async () => {
    if (!queries.length) { setRunMessage("검색어를 1개 이상 입력해 주세요."); return; }
    if (!sources.length) { setRunMessage("검색 소스를 1개 이상 선택해 주세요."); return; }
    setRunning(true);
    setRunMessage("");
    try {
      const response = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configBody()) });
      if (!response.ok) {
        const contentType = response.headers.get("content-type") ?? "";
        const detail = contentType.includes("application/json")
          ? ((await response.json().catch(() => ({}))) as { error?: string }).error ?? "알 수 없는 오류"
          : (await response.text()) || "알 수 없는 오류";
        setRunMessage(response.status === 504
          ? "실행이 시간 제한을 초과했습니다. 검색어 수나 수집량을 줄여 다시 시도해 주세요. 이미 저장된 후보는 목록에 반영되어 있습니다."
          : detail);
        await onRunComplete();
        return;
      }
      const result = await response.json() as {
        mode?: string;
        stoppedReason?: string | null;
        savedCandidates?: number;
        requestedQueryCount?: number;
        executedQueryCount?: number;
        stageCounts?: { collected?: number; llm2Analyzed?: number };
      };
      const querySummary = (result.requestedQueryCount ?? 0) > (result.executedQueryCount ?? 0)
        ? ` · 검색어 ${result.executedQueryCount}/${result.requestedQueryCount}개 실행`
        : "";
      const completion = result.stoppedReason === "time_budget" ? "시간 예산 내 부분 완료" : "실행 완료";
      setRunMessage(result.mode === "demo"
        ? "데모 실행 완료 · API 키 연결 시 실수집 시작"
        : `${completion} · ${result.stageCounts?.collected ?? 0}건 수집 / 신규 후보 ${result.savedCandidates ?? 0}건${querySummary}`);
      await onRunComplete();
    } catch (error) { setRunMessage(error instanceof Error ? error.message : "실행 실패"); }
    finally { setRunning(false); }
  };
  const saveConfig = async () => {
    if (!queries.length) { setRunMessage("검색어를 1개 이상 입력해 주세요."); return; }
    if (!sources.length) { setRunMessage("검색 소스를 1개 이상 선택해 주세요."); return; }
    setSaved(false);
    try { await fetch("/api/configs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configBody()) }); setSaved(true); }
    finally { window.setTimeout(() => setSaved(false), 1500); }
  };
  const toggleSource = (source: string) => setSources(current => {
    if (current.includes(source)) return current.filter(value => value !== source);
    if (current.length >= 3) {
      setRunMessage("수동 실행은 검색 소스를 최대 3개까지 선택할 수 있습니다.");
      return current;
    }
    setRunMessage("");
    return [...current, source];
  });
  const addQueries = () => {
    const additions = queryInput.split(/[,\n]/).map(value => value.trim()).filter(Boolean);
    if (!additions.length) return;
    setQueries(current => [...new Set([...current, ...additions])].slice(0, 20));
    setQueryInput("");
  };
  return <div className="settings-wrap">
    <div className="settings-grid">
      <section className="setting-card search-card query-card"><header><span>01</span><div><h2>검색어</h2><p>입력한 문구를 조합하거나 바꾸지 않고 그대로 검색합니다.</p></div><small>{queries.length} / 20</small></header><label className="field-label">직접 검색어</label><div className="query-entry"><input value={queryInput} onChange={e => setQueryInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addQueries(); } }} placeholder="검색어 입력 후 Enter · 쉼표로 여러 개 추가" /><button onClick={addQueries}>추가</button></div><div className="query-tags">{queries.map((query, index) => <span key={query}><b>{String(index + 1).padStart(2, "0")}</b>{query}<button onClick={() => setQueries(current => current.filter(value => value !== query))} aria-label={`${query} 삭제`}>×</button></span>)}{!queries.length && <p>등록된 검색어가 없습니다. 검색할 문구를 직접 입력해 주세요.</p>}</div>{queries.length > 5 && <p className="manual-limit-alert">검색어 {queries.length}개를 모두 저장하고, 이번 실행에서는 앞의 5개만 처리합니다.</p>}<label className="field-label">검색 소스</label><div className="source-options">{["네이버카페", "지식iN", "블로그", "웹문서", "Threads", "HN"].map(s => <button key={s} className={sources.includes(s) ? "on" : ""} onClick={() => toggleSource(s)}><i />{s}{s === "Threads" && <em>승인 필요</em>}</button>)}</div><p className="query-note">수동 실행은 최대 5개 검색어·소스 3개·네이버 전체 50건입니다. 나머지 검색어는 저장되어 매일 새벽 자동 실행에서 처리됩니다.</p></section>
      <section className="setting-card limit-card"><header><span>02</span><div><h2>수동 실행 상한</h2><p>300초 안에 안정적으로 끝나는 규모로 제한합니다.</p></div></header><div className="limit-grid"><label>이번 실행 검색어<div><input type="number" value={Math.min(queries.length, 5)} readOnly /><span>최대 5</span></div></label><label>네이버 수집 상한<div><input type="number" value="50" readOnly /><span>총 건수</span></div></label><label>자동 정밀 검증<div><input type="number" min="0" max="10" value={autoVerifyTopN} onChange={event => setAutoVerifyTopN(Math.min(10, Math.max(0, Number(event.target.value) || 0)))} /><span>상위 N건</span></div></label><label>일일 비용 상한<div><b>$</b><input type="number" defaultValue="3" /><span>최대 $10</span></div></label></div><div className="source-ratio-editor"><strong>네이버 소스 목표 비중</strong><label>지식iN <input type="number" min="0" max="100" value={sourceWeights.kin} onChange={event => setSourceWeights(current => ({ ...current, kin: Math.max(0, Number(event.target.value) || 0) }))} /><span>%</span></label><label>블로그 <input type="number" min="0" max="100" value={sourceWeights.blog} onChange={event => setSourceWeights(current => ({ ...current, blog: Math.max(0, Number(event.target.value) || 0) }))} /><span>%</span></label><label>카페 <input type="number" min="0" max="100" value={sourceWeights.cafearticle} onChange={event => setSourceWeights(current => ({ ...current, cafearticle: Math.max(0, Number(event.target.value) || 0) }))} /><span>%</span></label></div><p className="limit-note"><span>!</span> 비중은 활성화된 네이버 소스끼리 자동 정규화됩니다. 기본값은 지식iN 35% · 블로그 30% · 카페 35%입니다.</p></section>
    </div>
    <div className="settings-footer"><div>{(running || runMessage) && <span className={running ? "run-waiting" : ""}>{running && <i className="verify-spinner" />} {running ? `실행 중… (검색어 ${Math.min(queries.length, 5)}개, 최대 수 분 소요)` : runMessage}</span>}</div><button className="secondary" onClick={saveConfig}>{saved ? "✓ 저장됨" : "설정 저장"}</button><button className="primary" onClick={startRun} disabled={running}>{running ? "실행 중…" : "▶ 지금 실행"}</button></div>
  </div>;
}

function ArchiveView({ items, onRestore }: { items: Candidate[]; onRestore: (id: string) => void }) {
  const archived = items.filter(i => i.decision === "holding" || i.decision === "rejected");
  const [tab, setTab] = useState<"all" | Decision>("all");
  const shown = tab === "all" ? archived : archived.filter(i => i.decision === tab);
  return <div className="page-pad"><div className="archive-tools"><div className="tabs"><button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>전체 {archived.length}</button><button className={tab === "holding" ? "active" : ""} onClick={() => setTab("holding")}>보류 {archived.filter(i => i.decision === "holding").length}</button><button className={tab === "rejected" ? "active" : ""} onClick={() => setTab("rejected")}>기각 {archived.filter(i => i.decision === "rejected").length}</button></div><label className="searchbox"><span>⌕</span><input placeholder="보류함 검색" /></label></div>{shown.length ? <div className="archive-table"><div className="archive-head"><span>상태</span><span>후보</span><span>점수</span><span>사유</span><span>판정일</span><span /></div>{shown.map(i => <div className="archive-row" key={i.id}><span className={`status-label ${i.decision}`}>{STATUS_LABEL[i.decision]}</span><div><strong>{i.summary}</strong><small>{i.source} · {i.domain}</small></div><ScoreGauge score={i.score} max={i.scoreMax} /><p>{i.decisionReason ?? "사유 없음"}</p><time>{i.decidedAt ? new Date(i.decidedAt).toLocaleDateString("ko-KR") : "-"}</time><button onClick={() => onRestore(i.id)}>다시 검토 →</button></div>)}</div> : <div className="section-empty"><strong>보류하거나 기각한 후보가 없습니다.</strong><p>후보 검토 화면에서 판정하면 여기에 보존됩니다.</p></div>}</div>;
}

function LogsView({ runs }: { runs: RunLog[] }) {
  const [active, setActive] = useState(0);

  if (!runs.length) {
    return <div className="page-pad"><div className="section-empty"><strong>아직 실행 기록이 없습니다.</strong><p>실행 설정에서 수집을 시작하면 단계별 결과와 비용이 여기에 기록됩니다.</p></div></div>;
  }

  const safeActive = Math.min(active, runs.length - 1);
  const run = runs[safeActive];
  const collected = Number(run.stageCounts.collected ?? 0);
  const ruled = Number(run.stageCounts.rulePassed ?? 0);
  const llm1 = Number(run.stageCounts.llm1Passed ?? 0);
  const llm2 = Number(run.stageCounts.llm2Analyzed ?? 0);
  const verified = Number(run.stageCounts.verified ?? 0);
  const appVerified = Number(run.stageCounts.appVerified ?? 0);
  const llm1PassRate = Number(run.stageCounts.llm1_pass_rate ?? 0);
  const previouslyUserRejected = Number(run.stageCounts.previouslyUserRejected ?? 0);
  const activeFilterExcluded = Number(run.stageCounts.activeFilterExcluded ?? 0);
  const rejectReasonCounts = (run.stageCounts.reject_reason_counts as Record<string, number> | undefined) ?? {};
  const rejectEntries = Object.entries(rejectReasonCounts).filter(([, value]) => Number(value) > 0);
  const sourceCounts = (run.stageCounts.source_counts as Record<string, number> | undefined) ?? {};
  const sourceEntries = Object.entries(sourceCounts).filter(([, value]) => Number(value) > 0);
  const logSourceLabel: Record<string, string> = { kin: "지식iN", blog: "블로그", cafearticle: "카페", webkr: "웹문서", threads: "Threads", hn: "HN", appstore: "앱 리뷰" };
  const logRejectLabel: Record<string, string> = { promotional: "광고·홍보", 홍보: "홍보", 해결됨: "이미 해결됨" };
  const funnel = [["수집", collected], ["룰 통과", ruled], ["1차 통과", llm1], ["2차 분석", llm2], ["앱 검증", appVerified], ["정밀 검증", verified]] as const;
  const startedAt = new Date(run.startedAt);
  const endedAt = run.endedAt ? new Date(run.endedAt) : null;
  const duration = endedAt ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)) : null;
  const statusLabel = run.status === "completed" ? "완료" : run.status === "running" ? "실행 중" : "중단";

  return <div className="logs-layout">
    <aside className="run-list">
      <div className="run-list-head">최근 실행 <span>{runs.length}회</span></div>
      {runs.map((entry, i) => <button key={entry.id} className={safeActive === i ? "active" : ""} onClick={() => setActive(i)}>
        <div><strong>{new Date(entry.startedAt).toLocaleString("ko-KR")}</strong><span className={entry.status === "completed" ? "done" : "stopped"}>{entry.status === "completed" ? "완료" : entry.status === "running" ? "실행 중" : "중단"}</span></div>
        <p>{entry.preset}</p><small>{Number(entry.stageCounts.collected ?? 0).toLocaleString()}건 수집 · ${entry.cost.toFixed(4)}</small>
      </button>)}
    </aside>
    <section className="run-detail">
      <div className="run-summary"><div><span>RUN / {run.id.slice(0, 8)}</span><h2>{run.preset}</h2><p>{startedAt.toLocaleString("ko-KR")}{duration !== null ? ` · ${Math.floor(duration / 60)}분 ${duration % 60}초` : ""}</p></div><div><span>추정 비용</span><strong>${run.cost.toFixed(4)}</strong><small>{statusLabel}</small></div></div>
      {run.stoppedReason && <div className="stop-alert"><span>!</span><div><strong>실행이 중단됨</strong><p>{run.stoppedReason}</p></div></div>}
      <section className="funnel-section"><header><h3>단계별 통과</h3><span>수집 대비 정밀 검증 {collected ? ((verified / collected) * 100).toFixed(1) : "0.0"}%</span></header><div className="funnel">{funnel.map(([label, value], i) => <div key={label} style={{ width: `${100 - i * 11}%` }}><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{i === 0 ? "100%" : collected ? `${((value / collected) * 100).toFixed(1)}%` : "0.0%"}</small></div>)}</div></section>
      <div className="log-metrics">
        <div><span>LLM 1차 통과</span><strong>{llm1}</strong><small>{Number(run.stageCounts.llm1Evaluated ?? 0)}건 판정</small></div>
        <div><span>1차 통과율</span><strong>{(llm1PassRate * 100).toFixed(1)}%</strong><small>{llm1PassRate > 0.25 ? "25% 초과 경고" : "목표 10–15%"}</small></div>
        <div><span>앱 검증</span><strong>{appVerified}</strong><small>모든 신규 후보</small></div>
        <div><span>정밀 검증</span><strong>{verified}</strong><small>자동·수동 합계</small></div>
      </div>
      {sourceEntries.length > 0 && <section className="reject-breakdown"><header><h3>소스별 실제 수집</h3><span>네이버 기본 목표 · 지식iN 35% / 블로그 30% / 카페 35%</span></header><div>{sourceEntries.map(([source, count]) => <span key={source}><b>{logSourceLabel[source] ?? source}</b>{count}</span>)}</div></section>}
      {(previouslyUserRejected > 0 || activeFilterExcluded > 0) && <section className="reject-breakdown"><header><h3>사전 제외 영향</h3><span>이번 실행 기준</span></header><div><span><b>사용자 기각 재처리 차단</b>{previouslyUserRejected}</span><span><b>활성 필터 사전 제외</b>{activeFilterExcluded}</span></div></section>}
      {rejectEntries.length > 0 && <section className="reject-breakdown"><header><h3>1차 기각 사유</h3><span>{rejectEntries.reduce((sum, [, value]) => sum + Number(value), 0)}건</span></header><div>{rejectEntries.map(([reason, count]) => <span key={reason}><b>{logRejectLabel[reason] ?? reason}</b>{count}</span>)}</div></section>}
      <section className="error-log"><header><h3>실행 상태</h3></header><div><time>{endedAt ? endedAt.toLocaleTimeString("ko-KR") : startedAt.toLocaleTimeString("ko-KR")}</time><span className={run.status === "completed" ? "info-pill" : "warn-pill"}>{statusLabel}</span><p>{run.stoppedReason || run.errors[0] || "파이프라인 실행 기록이 정상적으로 저장되었습니다."}</p></div></section>
    </section>
  </div>;
}
