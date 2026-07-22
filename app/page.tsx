"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type View = "today" | "signals" | "settings" | "archive" | "logs";
type Decision = "unreviewed" | "tracking" | "holding" | "rejected";
type MarketVerdict = "empty" | "all_free" | "public_owned" | "paid_exists" | "crowded";
type CompetitorPricing = "free" | "freemium" | "paid" | "public" | "unknown";

type Candidate = {
  id: string;
  summary: string;
  who: string;
  source: string;
  sourceTone: string;
  time: string;
  score: number;
  competitors: number;
  marketVerdict: MarketVerdict;
  decision: Decision;
  domain: string;
  frequency: string;
  signal: string;
  excerpt: string;
  workaround: string;
  money: string | null;
  recurrence: number;
  access: boolean;
  scores: { label: string; value: number }[];
  rivals: { name: string; url: string; pricing: CompetitorPricing; note: string; state: CompetitorPricing }[];
  url: string;
  decisionReason?: string | null;
  decidedAt?: string | null;
};

type RunLog = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  preset: string;
  status: "completed" | "running" | "stopped";
  stageCounts: Record<string, number>;
  llmCalls: Record<string, number>;
  cost: number;
  stoppedReason: string | null;
  errors: string[];
};

const NAV: { id: View; label: string; mark: string; count?: number }[] = [
  { id: "today", label: "오늘의 후보", mark: "01" },
  { id: "signals", label: "반복 신호", mark: "02" },
  { id: "settings", label: "실행 설정", mark: "03" },
  { id: "archive", label: "보류함", mark: "04" },
  { id: "logs", label: "실행 로그", mark: "05" },
];

const STATUS_LABEL: Record<Decision, string> = {
  unreviewed: "미검토", tracking: "추적", holding: "보류", rejected: "기각",
};

const MARKET_LABEL: Record<MarketVerdict, string> = {
  paid_exists: "유료 존재", crowded: "붐빔", all_free: "전부 무료", public_owned: "공공 제공", empty: "경쟁자 없음",
};

const PRICING_LABEL: Record<CompetitorPricing, string> = {
  free: "무료", freemium: "부분 무료", paid: "유료", public: "공공 제공", unknown: "가격 미확인",
};

function buildCandidatesText(items: Candidate[]) {
  const createdAt = new Date().toLocaleString("ko-KR");
  const sections = items.map((item, index) => {
    const scores = item.scores.map(score => `- ${score.label}: ${score.value}/2`).join("\n");
    const rivals = item.rivals.length
      ? item.rivals.map((rival, rivalIndex) => [
          `  ${rivalIndex + 1}. ${rival.name}`,
          `     가격: ${PRICING_LABEL[rival.pricing]}`,
          `     설명: ${rival.note}`,
          `     URL: ${rival.url}`,
        ].join("\n")).join("\n")
      : "  확인된 제품 경쟁자 없음";

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
      `시장 판정: ${MARKET_LABEL[item.marketVerdict]} (${item.competitors}개)`,
      `총점: ${item.score}/12`,
      "",
      "[원문 신호]",
      item.excerpt,
      `원문 URL: ${item.url || "없음"}`,
      "",
      "[LLM 분석]",
      `현재 우회 수단: ${item.workaround}`,
      `지불 신호: ${item.money ?? "명시적 신호 없음"}`,
      "",
      "[6개 필터 점수]",
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

function ScoreGauge({ score }: { score: number }) {
  return <span className={`score score-${score >= 9 ? "high" : score >= 7 ? "mid" : "low"}`}><strong>{score}</strong><small>/12</small></span>;
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
  const [rejectReason, setRejectReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);

  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);
  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const data = await response.json() as { candidates?: Candidate[]; logs?: RunLog[]; setupRequired?: boolean; error?: string };
      const nextItems = data.candidates ?? [];
      setItems(nextItems); setLogs(data.logs ?? []); setSetupRequired(Boolean(data.setupRequired));
      setDataError(response.ok ? "" : (data.error ?? "데이터를 불러오지 못했습니다."));
      setSelectedId(current => nextItems.some(item => item.id === current) ? current : (nextItems[0]?.id ?? ""));
    } catch { setDataError("서버에 연결하지 못했습니다."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadDashboard(); }, [loadDashboard]);
  const visible = useMemo(() => items.filter(item =>
    (sourceFilter === "전체 소스" || item.source === sourceFilter) &&
    (item.summary.includes(search) || item.domain.includes(search) || item.who.includes(search))
  ), [items, search, sourceFilter]);
  const selected = items.find(i => i.id === selectedId) ?? items[0];

  const decide = (decision: Decision) => {
    if (!selectedId) return;
    setItems(prev => prev.map(item => item.id === selectedId ? { ...item, decision } : item));
    void fetch("/api/decisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ painPointId: selectedId, action: decision, reason: decision === "rejected" ? rejectReason : null }) });
    setRejecting(false); setRejectReason("");
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (view !== "today" || ["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement).tagName)) return;
      const index = visible.findIndex(i => i.id === selectedId);
      if (event.key.toLowerCase() === "j") setSelectedId(visible[Math.min(index + 1, visible.length - 1)]?.id ?? selectedId);
      if (event.key.toLowerCase() === "k") setSelectedId(visible[Math.max(index - 1, 0)]?.id ?? selectedId);
      if (event.key.toLowerCase() === "t") decide("tracking");
      if (event.key.toLowerCase() === "h") decide("holding");
      if (event.key.toLowerCase() === "x") setRejecting(true);
      if (event.key === "Enter" && selected?.url) window.open(selected.url, "_blank", "noopener,noreferrer");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, visible, selectedId, selected?.url]);

  const titles: Record<View, [string, string]> = {
    today: ["오늘의 후보", "경쟁 검증을 통과한 신호부터 검토하세요."],
    signals: ["반복 신호", "서로 다른 시점과 출처에서 다시 나타난 문제입니다."],
    settings: ["실행 설정", "검색어, 수집 소스, 비용 상한을 정하고 바로 실행합니다."],
    archive: ["보류함", "판단 기준이 바뀌면 언제든 다시 검토할 수 있습니다."],
    logs: ["실행 로그", "어디서 걸러졌고 왜 멈췄는지 숨김없이 보여줍니다."],
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("today")} aria-label="Painfinder 홈"><span className="brand-mark">P</span><span>PAIN<strong>FINDER</strong><small>RESEARCH CONSOLE</small></span></button>
        <nav aria-label="주요 메뉴">
          {NAV.map(n => { const count = n.id === "today" ? items.length : n.id === "signals" ? items.filter(i => i.recurrence >= 2).length : n.id === "archive" ? items.filter(i => i.decision === "holding" || i.decision === "rejected").length : 0; return <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => setView(n.id)}><b>{n.mark}</b><span>{n.label}</span>{count > 0 && <em>{count}</em>}</button>; })}
        </nav>
        <div className="sidebar-run">
          <div><span>실제 후보</span><strong>{items.length}건</strong></div>
          <div className="meter"><i style={{ width: items.length ? "100%" : "0%" }} /></div>
          <button onClick={() => setView("settings")}><span>▶</span> 지금 실행</button>
        </div>
        <div className="shortcut-legend"><p>KEYBOARD</p><div><kbd>J</kbd><kbd>K</kbd><span>이동</span></div><div><kbd>T</kbd><span>추적</span><kbd>H</kbd><span>보류</span></div><div><kbd>X</kbd><span>기각</span><kbd>↵</kbd><span>원문</span></div></div>
      </aside>

      <section className="workspace">
        <Topbar title={titles[view][0]} subtitle={titles[view][1]} dark={dark} setDark={setDark} />
        {view === "today" && (selected ? <TodayView allItems={items} visible={visible} selected={selected} lastRun={logs[0]} setSelectedId={setSelectedId} search={search} setSearch={setSearch} sourceFilter={sourceFilter} setSourceFilter={setSourceFilter} onDecision={decide} rejecting={rejecting} setRejecting={setRejecting} rejectReason={rejectReason} setRejectReason={setRejectReason} /> : <DashboardEmpty loading={loading} error={dataError} setupRequired={setupRequired} onSettings={() => setView("settings")} onRetry={loadDashboard} />)}
        {view === "signals" && <SignalsView items={items} onOpen={(id) => { setSelectedId(id); setView("today"); }} />}
        {view === "settings" && <SettingsView onRunComplete={loadDashboard} />}
        {view === "archive" && <ArchiveView items={items} onRestore={(id) => { setSelectedId(id); setView("today"); }} />}
        {view === "logs" && <LogsView runs={logs} />}
      </section>

      <nav className="mobile-nav" aria-label="모바일 메뉴">{NAV.map(n => <button key={n.id} onClick={() => setView(n.id)} className={view === n.id ? "active" : ""}><b>{n.mark}</b><span>{n.label.replace("오늘의 ", "")}</span></button>)}</nav>
    </main>
  );
}

function TodayView({ allItems, visible, selected, lastRun, setSelectedId, search, setSearch, sourceFilter, setSourceFilter, onDecision, rejecting, setRejecting, rejectReason, setRejectReason }: {
  allItems: Candidate[]; visible: Candidate[]; selected: Candidate; lastRun?: RunLog; setSelectedId: (id: string) => void; search: string; setSearch: (v: string) => void; sourceFilter: string; setSourceFilter: (v: string) => void; onDecision: (d: Decision) => void; rejecting: boolean; setRejecting: (v: boolean) => void; rejectReason: string; setRejectReason: (v: string) => void;
}) {
  const rejected = allItems.filter(item => item.decision === "rejected").length;
  return <div className="today-layout">
    <section className="candidate-pane">
      <div className="stat-strip">
        <div><span>전체 후보</span><strong>{allItems.length}</strong><small>실제 축적 데이터</small></div>
        <div><span>검증 대기</span><strong>{allItems.filter(i => i.decision === "unreviewed").length}</strong><small>직접 검토 필요</small></div>
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
        {visible.map(item => <button key={item.id} className={`candidate-row ${selected.id === item.id ? "selected" : ""}`} onClick={() => setSelectedId(item.id)}>
          <div className="row-status"><i className={`status-dot ${item.decision}`} /><ScoreGauge score={item.score} /></div>
          <div className="row-main"><h3>{item.summary}</h3><div><span className={`source-tag ${item.sourceTone}`}>{item.source}</span><span>{item.domain}</span><span>{item.time}</span>{item.recurrence >= 3 && <span className="repeat-tag">↻ {item.recurrence}회 반복</span>}</div></div>
          <div className={`market-badge ${item.marketVerdict}`}>{MARKET_LABEL[item.marketVerdict]}{item.marketVerdict !== "empty" && item.marketVerdict !== "public_owned" ? ` (${item.competitors})` : ""}</div>
          <span className={`status-label ${item.decision}`}>{STATUS_LABEL[item.decision]}</span>
        </button>)}
        {visible.length === 0 && <div className="empty">조건에 맞는 후보가 없습니다.</div>}
      </div>
    </section>

    <aside className="detail-pane">
      <div className="detail-scroll">
        <div className="detail-kicker"><span className={`source-tag ${selected.sourceTone}`}>{selected.source}</span><span>{selected.time}</span><span>ID · PF-{String(selected.id).padStart(4, "0")}</span></div>
        <div className="detail-title"><div><h2>{selected.summary}</h2><p>{selected.who} · {selected.frequency} 발생</p></div><ScoreGauge score={selected.score} /></div>
        <section className="detail-section original"><header><h3>원문 신호</h3><a href={selected.url} target="_blank" rel="noreferrer">원문 열기 ↗</a></header><blockquote>“{selected.excerpt}”</blockquote></section>
        <section className="detail-section analysis"><header><h3>LLM 분석</h3><span>구조화 분석 완료</span></header><dl><div><dt>누가</dt><dd>{selected.who}</dd></div><div><dt>현재 우회 수단</dt><dd>{selected.workaround}</dd></div><div><dt>신호 유형</dt><dd><span className="amber-text">{selected.signal}</span> · {selected.frequency}</dd></div><div><dt>지불 신호</dt><dd>{selected.money ? `“${selected.money}”` : <span className="muted">명시적 신호 없음</span>}</dd></div></dl></section>
        <section className="detail-section competitors"><header><h3>경쟁 검증 <b>{selected.rivals.length}</b></h3><span className={`market-badge ${selected.marketVerdict}`}>{MARKET_LABEL[selected.marketVerdict]}</span></header>
          {selected.rivals.length ? <div className="rival-list">{selected.rivals.map(r => <a key={r.url || r.name} href={r.url} target="_blank" rel="noreferrer"><i className={`rival-state ${r.state}`} /> <strong>{r.name}</strong><span className={`pricing-badge ${r.pricing}`}>{PRICING_LABEL[r.pricing]}</span><p>{r.note}</p><em>↗</em></a>)}</div> : <div className="zero-rivals"><strong>확인된 제품 경쟁자가 없습니다.</strong><p>자동 합격이 아닙니다. 수요가 형성되지 않은 시장일 수 있어 직접 확인이 필요합니다.</p></div>}
        </section>
        <section className="detail-section scorecard"><header><h3>6개 필터</h3><span>{selected.score} / 12점</span></header><div className="score-grid">{selected.scores.map(s => <div key={s.label}><span>{s.label}</span><div className="score-track"><i style={{ width: `${s.value * 50}%` }} /></div><b>{s.value}</b></div>)}</div><div className={`access-flag ${selected.access ? "stable" : "unstable"}`}><span>{selected.access ? "✓" : "!"}</span><div><strong>데이터 접근 {selected.access ? "안정" : "불안정"}</strong><small>{selected.access ? "공식 API 또는 공개 데이터 확인" : "공식 API가 없어 별도 검토 필요"}</small></div></div></section>
      </div>
      <div className="decision-bar">
        {rejecting ? <div className="reject-form"><input autoFocus value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="기각 사유를 입력하세요" /><button onClick={() => onDecision("rejected")} disabled={!rejectReason.trim()}>기각 확정</button><button onClick={() => setRejecting(false)}>취소</button></div> : <><button className="track" onClick={() => onDecision("tracking")}><kbd>T</kbd> 추적</button><button onClick={() => onDecision("holding")}><kbd>H</kbd> 보류</button><button className="reject" onClick={() => setRejecting(true)}><kbd>X</kbd> 기각</button></>}
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

function SettingsView({ onRunComplete }: { onRunComplete: () => void }) {
  const [sources, setSources] = useState(["네이버카페", "지식iN", "블로그"]);
  const [queries, setQueries] = useState<string[]>([]);
  const [queryInput, setQueryInput] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saved, setSaved] = useState(false);
  const [runMessage, setRunMessage] = useState("");
  const configBody = () => ({
    name: "직접 검색",
    queries,
    sources: Object.fromEntries(sources.map(source => [source, true])),
    period_days: 7,
    limits: { queries: Math.min(Math.max(queries.length, 1), 50), itemsPerSource: 500, dailyCostUsd: 3 },
  });
  const startRun = async () => {
    if (!queries.length) { setRunMessage("검색어를 1개 이상 입력해 주세요."); setProgress(100); return; }
    if (!sources.length) { setRunMessage("검색 소스를 1개 이상 선택해 주세요."); setProgress(100); return; }
    setRunning(true); setProgress(8); setRunMessage("파이프라인을 시작하는 중");
    const timer = window.setInterval(() => setProgress(p => Math.min(86, p + 5)), 450);
    try {
      const response = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configBody()) });
      const result = await response.json() as { mode?: string; error?: string; stageCounts?: { collected?: number; llm2Analyzed?: number } };
      if (!response.ok) throw new Error(result.error ?? "실행 실패");
      setProgress(100);
      setRunMessage(result.mode === "demo" ? "데모 실행 완료 · API 키 연결 시 실수집 시작" : `실행 완료 · ${result.stageCounts?.collected ?? 0}건 수집 / ${result.stageCounts?.llm2Analyzed ?? 0}건 분석`);
      await onRunComplete();
    } catch (error) { setRunMessage(error instanceof Error ? error.message : "실행 실패"); }
    finally { window.clearInterval(timer); setRunning(false); }
  };
  const saveConfig = async () => {
    if (!queries.length) { setRunMessage("검색어를 1개 이상 입력해 주세요."); setProgress(100); return; }
    if (!sources.length) { setRunMessage("검색 소스를 1개 이상 선택해 주세요."); setProgress(100); return; }
    setSaved(false);
    try { await fetch("/api/configs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configBody()) }); setSaved(true); }
    finally { window.setTimeout(() => setSaved(false), 1500); }
  };
  const toggleSource = (source: string) => setSources(s => s.includes(source) ? s.filter(x => x !== source) : [...s, source]);
  const addQueries = () => {
    const additions = queryInput.split(/[,\n]/).map(value => value.trim()).filter(Boolean);
    if (!additions.length) return;
    setQueries(current => [...new Set([...current, ...additions])].slice(0, 50));
    setQueryInput("");
  };
  return <div className="settings-wrap">
    <div className="settings-grid">
      <section className="setting-card search-card query-card"><header><span>01</span><div><h2>검색어</h2><p>입력한 문구를 조합하거나 바꾸지 않고 그대로 검색합니다.</p></div><small>{queries.length} / 50</small></header><label className="field-label">직접 검색어</label><div className="query-entry"><input value={queryInput} onChange={e => setQueryInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addQueries(); } }} placeholder="검색어 입력 후 Enter · 쉼표로 여러 개 추가" /><button onClick={addQueries}>추가</button></div><div className="query-tags">{queries.map((query, index) => <span key={query}><b>{String(index + 1).padStart(2, "0")}</b>{query}<button onClick={() => setQueries(current => current.filter(value => value !== query))} aria-label={`${query} 삭제`}>×</button></span>)}{!queries.length && <p>등록된 검색어가 없습니다. 검색할 문구를 직접 입력해 주세요.</p>}</div><label className="field-label">검색 소스</label><div className="source-options">{["네이버카페", "지식iN", "블로그", "웹문서", "Threads", "HN"].map(s => <button key={s} className={sources.includes(s) ? "on" : ""} onClick={() => toggleSource(s)}><i />{s}{s === "Threads" && <em>승인 필요</em>}</button>)}</div><p className="query-note">등록한 검색어를 선택한 각 소스에 한 번씩 그대로 요청합니다.</p></section>
      <section className="setting-card limit-card"><header><span>02</span><div><h2>하드 상한</h2><p>예상 밖의 폭주를 코드와 설정에서 이중 차단합니다.</p></div></header><div className="limit-grid"><label>이번 실행 검색어<div><input type="number" value={queries.length} readOnly /><span>최대 50</span></div></label><label>소스별 수집 상한<div><input type="number" defaultValue="500" /><span>건</span></div></label><label>일일 비용 상한<div><b>$</b><input type="number" defaultValue="3" /><span>최대 $10</span></div></label></div><p className="limit-note"><span>!</span> 상한 도달 시 실행을 즉시 중단하고 로그에 이유를 남깁니다.</p></section>
    </div>
    <div className="settings-footer"><div>{progress > 0 && <><span>{running ? `파이프라인 실행 중 · ${progress}%` : runMessage}</span><div className="run-progress"><i style={{ width: `${progress}%` }} /></div></>}</div><button className="secondary" onClick={saveConfig}>{saved ? "✓ 저장됨" : "설정 저장"}</button><button className="primary" onClick={startRun} disabled={running}>{running ? `${progress}% 처리 중` : "▶ 지금 실행"}</button></div>
  </div>;
}

function ArchiveView({ items, onRestore }: { items: Candidate[]; onRestore: (id: string) => void }) {
  const archived = items.filter(i => i.decision === "holding" || i.decision === "rejected");
  const [tab, setTab] = useState<"all" | Decision>("all");
  const shown = tab === "all" ? archived : archived.filter(i => i.decision === tab);
  return <div className="page-pad"><div className="archive-tools"><div className="tabs"><button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>전체 {archived.length}</button><button className={tab === "holding" ? "active" : ""} onClick={() => setTab("holding")}>보류 {archived.filter(i => i.decision === "holding").length}</button><button className={tab === "rejected" ? "active" : ""} onClick={() => setTab("rejected")}>기각 {archived.filter(i => i.decision === "rejected").length}</button></div><label className="searchbox"><span>⌕</span><input placeholder="보류함 검색" /></label></div>{shown.length ? <div className="archive-table"><div className="archive-head"><span>상태</span><span>후보</span><span>점수</span><span>사유</span><span>판정일</span><span /></div>{shown.map(i => <div className="archive-row" key={i.id}><span className={`status-label ${i.decision}`}>{STATUS_LABEL[i.decision]}</span><div><strong>{i.summary}</strong><small>{i.source} · {i.domain}</small></div><ScoreGauge score={i.score} /><p>{i.decisionReason ?? "사유 없음"}</p><time>{i.decidedAt ? new Date(i.decidedAt).toLocaleDateString("ko-KR") : "-"}</time><button onClick={() => onRestore(i.id)}>다시 검토 →</button></div>)}</div> : <div className="section-empty"><strong>보류하거나 기각한 후보가 없습니다.</strong><p>후보 검토 화면에서 판정하면 여기에 보존됩니다.</p></div>}</div>;
}

function LogsView({ runs }: { runs: RunLog[] }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (active >= runs.length) setActive(0);
  }, [active, runs.length]);

  if (!runs.length) {
    return <div className="page-pad"><div className="section-empty"><strong>아직 실행 기록이 없습니다.</strong><p>실행 설정에서 수집을 시작하면 단계별 결과와 비용이 여기에 기록됩니다.</p></div></div>;
  }

  const run = runs[active];
  const collected = Number(run.stageCounts.collected ?? 0);
  const ruled = Number(run.stageCounts.rulePassed ?? 0);
  const llm1 = Number(run.stageCounts.llm1Passed ?? 0);
  const llm2 = Number(run.stageCounts.llm2Analyzed ?? 0);
  const verified = Number(run.stageCounts.verified ?? 0);
  const funnel = [["수집", collected], ["룰 통과", ruled], ["1차 통과", llm1], ["2차 분석", llm2], ["검증 완료", verified]] as const;
  const startedAt = new Date(run.startedAt);
  const endedAt = run.endedAt ? new Date(run.endedAt) : null;
  const duration = endedAt ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)) : null;
  const statusLabel = run.status === "completed" ? "완료" : run.status === "running" ? "실행 중" : "중단";

  return <div className="logs-layout"><aside className="run-list"><div className="run-list-head">최근 실행 <span>{runs.length}회</span></div>{runs.map((entry, i) => <button key={entry.id} className={active === i ? "active" : ""} onClick={() => setActive(i)}><div><strong>{new Date(entry.startedAt).toLocaleString("ko-KR")}</strong><span className={entry.status === "completed" ? "done" : "stopped"}>{entry.status === "completed" ? "완료" : entry.status === "running" ? "실행 중" : "중단"}</span></div><p>{entry.preset}</p><small>{Number(entry.stageCounts.collected ?? 0).toLocaleString()}건 수집 · ${entry.cost.toFixed(4)}</small></button>)}</aside><section className="run-detail"><div className="run-summary"><div><span>RUN / {run.id.slice(0, 8)}</span><h2>{run.preset}</h2><p>{startedAt.toLocaleString("ko-KR")}{duration !== null ? ` · ${Math.floor(duration / 60)}분 ${duration % 60}초` : ""}</p></div><div><span>추정 비용</span><strong>${run.cost.toFixed(4)}</strong><small>{statusLabel}</small></div></div>{run.stoppedReason && <div className="stop-alert"><span>!</span><div><strong>실행이 중단됨</strong><p>{run.stoppedReason}</p></div></div>}<section className="funnel-section"><header><h3>단계별 통과</h3><span>수집 대비 최종 {collected ? ((verified / collected) * 100).toFixed(1) : "0.0"}%</span></header><div className="funnel">{funnel.map(([label, value], i) => <div key={label} style={{ width: `${100 - i * 13}%` }}><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{i === 0 ? "100%" : collected ? `${((value / collected) * 100).toFixed(1)}%` : "0.0%"}</small></div>)}</div></section><div className="log-metrics"><div><span>LLM 1차 통과</span><strong>{llm1}</strong><small>실제 기록</small></div><div><span>LLM 2차 분석</span><strong>{llm2}</strong><small>실제 기록</small></div><div><span>검증 완료</span><strong>{verified}</strong><small>실제 기록</small></div><div><span>오류</span><strong>{run.errors.length}</strong><small>{run.errors.length ? "확인 필요" : "없음"}</small></div></div><section className="error-log"><header><h3>실행 상태</h3></header><div><time>{endedAt ? endedAt.toLocaleTimeString("ko-KR") : startedAt.toLocaleTimeString("ko-KR")}</time><span className={run.status === "completed" ? "info-pill" : "warn-pill"}>{statusLabel}</span><p>{run.stoppedReason || run.errors[0] || "파이프라인 실행 기록이 정상적으로 저장되었습니다."}</p></div></section></section></div>;
}
