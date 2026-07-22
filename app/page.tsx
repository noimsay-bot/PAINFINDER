"use client";

import { useEffect, useMemo, useState } from "react";

type View = "today" | "signals" | "settings" | "archive" | "logs";
type Decision = "unreviewed" | "tracking" | "holding" | "rejected";

type Candidate = {
  id: number;
  summary: string;
  who: string;
  source: string;
  sourceTone: string;
  time: string;
  score: number;
  competitors: number;
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
  rivals: { name: string; pricing: string; note: string; state: "old" | "paid" | "free" }[];
  url: string;
};

const CANDIDATES: Candidate[] = [
  {
    id: 1,
    summary: "소규모 식품 제조업체가 HACCP 기록을 종이와 엑셀에 이중 입력한다",
    who: "소규모 식품공장 품질관리자",
    source: "네이버 카페",
    sourceTone: "cafe",
    time: "18분 전",
    score: 10,
    competitors: 3,
    decision: "unreviewed",
    domain: "식품 제조",
    frequency: "매일",
    signal: "우회 수단",
    excerpt: "온도일지랑 점검표를 현장에서 종이로 쓰고 퇴근 전에 다시 엑셀에 옮깁니다. 직원이 7명뿐이라 전용 솔루션은 너무 비싸고, 다들 어떻게 관리하시는지 궁금합니다.",
    workaround: "현장 종이 기록 후 담당자가 엑셀에 재입력",
    money: "월 10만 원 안쪽이면 바로 쓸 것 같아요.",
    recurrence: 4,
    access: true,
    scores: [
      { label: "AI 대체 불가성", value: 2 }, { label: "기술 진입장벽", value: 2 },
      { label: "포털 비대체성", value: 2 }, { label: "인컴번트 상태", value: 2 },
      { label: "지불 의향", value: 1 }, { label: "유지보수 부담", value: 1 },
    ],
    rivals: [
      { name: "세이프키친", pricing: "월 29만 원", note: "기능은 좋지만 20인 이상 사업장 중심", state: "paid" },
      { name: "HACCP 노트", pricing: "무료", note: "2022년 이후 업데이트 없음", state: "old" },
      { name: "스마트해썹", pricing: "견적 문의", note: "하드웨어 설치가 필수", state: "paid" },
    ],
    url: "https://search.naver.com/search.naver?query=HACCP+%EC%97%91%EC%85%80+%EA%B4%80%EB%A6%AC",
  },
  {
    id: 2,
    summary: "학원 강사가 보강 수업 가능 시간을 학부모 카톡으로 일일이 조율한다",
    who: "소형 보습학원 강사",
    source: "지식iN",
    sourceTone: "kin",
    time: "46분 전",
    score: 9,
    competitors: 5,
    decision: "unreviewed",
    domain: "교육",
    frequency: "매주",
    signal: "질문형",
    excerpt: "결석생 보강을 잡을 때마다 부모님들께 카톡을 따로 보내고 시간표를 대조합니다. 학생 40명만 넘어가도 누락이 생기는데 이런 것만 해주는 앱은 없을까요?",
    workaround: "카카오톡 개별 연락 + 종이 시간표",
    money: null,
    recurrence: 3,
    access: true,
    scores: [
      { label: "AI 대체 불가성", value: 2 }, { label: "기술 진입장벽", value: 1 },
      { label: "포털 비대체성", value: 2 }, { label: "인컴번트 상태", value: 2 },
      { label: "지불 의향", value: 1 }, { label: "유지보수 부담", value: 1 },
    ],
    rivals: [
      { name: "클래스매니저", pricing: "월 5.5만 원", note: "전체 학원 ERP에 기능이 묶여 있음", state: "paid" },
      { name: "보강톡", pricing: "무료", note: "안드로이드만 지원", state: "old" },
      { name: "학원친구", pricing: "월 9.9만 원", note: "20명 이하 요금제가 없음", state: "paid" },
      { name: "타임트리", pricing: "무료", note: "보강 워크플로우 부재", state: "free" },
      { name: "네이버 예약", pricing: "무료", note: "학부모 다대일 조율 불가", state: "free" },
    ],
    url: "https://search.naver.com/search.naver?query=%ED%95%99%EC%9B%90+%EB%B3%B4%EA%B0%95+%EC%8B%9C%EA%B0%84+%EC%A1%B0%EC%9C%A8",
  },
  {
    id: 3,
    summary: "여러 오픈마켓 판매자가 반품 사유를 한곳에서 비교하지 못한다",
    who: "온라인 셀러",
    source: "앱 리뷰",
    sourceTone: "app",
    time: "1시간 전",
    score: 8,
    competitors: 2,
    decision: "tracking",
    domain: "이커머스",
    frequency: "매일",
    signal: "인컴번트 결함",
    excerpt: "주문은 모아주면서 왜 반품 사유는 마켓별로 들어가서 봐야 하나요. 불량 패턴을 보고 싶은데 결국 CSV를 각각 받아서 합치고 있습니다.",
    workaround: "마켓별 CSV 다운로드 후 수동 병합",
    money: "이미 주문 통합 솔루션에 월 15만 원 결제 중",
    recurrence: 5,
    access: true,
    scores: [
      { label: "AI 대체 불가성", value: 2 }, { label: "기술 진입장벽", value: 2 },
      { label: "포털 비대체성", value: 2 }, { label: "인컴번트 상태", value: 1 },
      { label: "지불 의향", value: 1 }, { label: "유지보수 부담", value: 0 },
    ],
    rivals: [
      { name: "셀러허브", pricing: "월 15만 원", note: "반품 분석은 미지원", state: "paid" },
      { name: "이지어드민", pricing: "견적 문의", note: "기능이 무겁고 도입 비용 높음", state: "paid" },
    ],
    url: "https://search.naver.com/search.naver?query=%EC%98%A4%ED%94%88%EB%A7%88%EC%BC%93+%EB%B0%98%ED%92%88+%EC%82%AC%EC%9C%A0+%ED%86%B5%ED%95%A9",
  },
  {
    id: 4,
    summary: "방문 간호사가 환자별 소모품 재고를 퇴근 후 수기로 정리한다",
    who: "방문간호센터 팀장",
    source: "네이버 블로그",
    sourceTone: "blog",
    time: "2시간 전",
    score: 8,
    competitors: 0,
    decision: "holding",
    domain: "의료·돌봄",
    frequency: "매주",
    signal: "포기형",
    excerpt: "기록할 게 너무 많아 소모품은 대충 눈대중으로 챙깁니다. 예전엔 엑셀로 해봤는데 현장에서 안 쓰니 결국 포기했어요.",
    workaround: "차량에 여유분을 과다 적재",
    money: null,
    recurrence: 2,
    access: false,
    scores: [
      { label: "AI 대체 불가성", value: 2 }, { label: "기술 진입장벽", value: 1 },
      { label: "포털 비대체성", value: 2 }, { label: "인컴번트 상태", value: 1 },
      { label: "지불 의향", value: 1 }, { label: "유지보수 부담", value: 1 },
    ],
    rivals: [],
    url: "https://search.naver.com/search.naver?query=%EB%B0%A9%EB%AC%B8%EA%B0%84%ED%98%B8+%EC%86%8C%EB%AA%A8%ED%92%88+%EC%9E%AC%EA%B3%A0",
  },
  {
    id: 5,
    summary: "동호회 총무가 회비와 참석 여부를 매번 별도 시트로 맞춘다",
    who: "생활체육 동호회 총무",
    source: "네이버 카페",
    sourceTone: "cafe",
    time: "3시간 전",
    score: 4,
    competitors: 7,
    decision: "rejected",
    domain: "커뮤니티",
    frequency: "매월",
    signal: "탐색형",
    excerpt: "회비 낸 사람과 이번 달 참석자를 맞추는 간단한 앱 추천 부탁드립니다. 밴드 투표랑 엑셀을 같이 쓰고 있어요.",
    workaround: "밴드 투표 + 엑셀",
    money: null,
    recurrence: 2,
    access: true,
    scores: [
      { label: "AI 대체 불가성", value: 1 }, { label: "기술 진입장벽", value: 0 },
      { label: "포털 비대체성", value: 1 }, { label: "인컴번트 상태", value: 0 },
      { label: "지불 의향", value: 0 }, { label: "유지보수 부담", value: 2 },
    ],
    rivals: [
      { name: "소모임", pricing: "무료", note: "회비·출석 기능 제공", state: "free" },
      { name: "밴드", pricing: "무료", note: "사용자 기반이 강함", state: "free" },
      { name: "모임장부", pricing: "무료", note: "핵심 기능 충족", state: "free" },
    ],
    url: "https://search.naver.com/search.naver?query=%EB%8F%99%ED%98%B8%ED%9A%8C+%ED%9A%8C%EB%B9%84+%EC%B6%9C%EC%84%9D+%EC%95%B1",
  },
  {
    id: 6,
    summary: "건축사무소가 현장 사진을 프로젝트·공정별로 다시 분류한다",
    who: "소형 건축사무소 실무자",
    source: "Threads",
    sourceTone: "threads",
    time: "4시간 전",
    score: 9,
    competitors: 4,
    decision: "unreviewed",
    domain: "건설",
    frequency: "매일",
    signal: "감정형",
    excerpt: "현장 사진 200장 받아서 또 폴더명 바꾸는 중. 카톡으로 받으면 촬영 위치랑 날짜가 다 날아가서 진짜 답답하다.",
    workaround: "카톡 수신 후 파일명과 폴더 수동 정리",
    money: "현장별 협업툴 구독 경험 있음",
    recurrence: 3,
    access: true,
    scores: [
      { label: "AI 대체 불가성", value: 2 }, { label: "기술 진입장벽", value: 2 },
      { label: "포털 비대체성", value: 2 }, { label: "인컴번트 상태", value: 1 },
      { label: "지불 의향", value: 1 }, { label: "유지보수 부담", value: 1 },
    ],
    rivals: [
      { name: "아키엠", pricing: "월 12만 원", note: "대형 현장 중심", state: "paid" },
      { name: "필드와이어", pricing: "$39/인", note: "국문 지원이 약함", state: "paid" },
      { name: "현장통", pricing: "무료", note: "업데이트가 느림", state: "old" },
      { name: "카카오워크", pricing: "무료", note: "공정 메타데이터 없음", state: "free" },
    ],
    url: "https://search.naver.com/search.naver?query=%EA%B1%B4%EC%B6%95+%ED%98%84%EC%9E%A5+%EC%82%AC%EC%A7%84+%EC%A0%95%EB%A6%AC",
  },
];

const NAV: { id: View; label: string; mark: string; count?: number }[] = [
  { id: "today", label: "오늘의 후보", mark: "01", count: 4 },
  { id: "signals", label: "반복 신호", mark: "02", count: 5 },
  { id: "settings", label: "실행 설정", mark: "03" },
  { id: "archive", label: "보류함", mark: "04", count: 2 },
  { id: "logs", label: "실행 로그", mark: "05" },
];

const STATUS_LABEL: Record<Decision, string> = {
  unreviewed: "미검토", tracking: "추적", holding: "보류", rejected: "기각",
};

function ScoreGauge({ score }: { score: number }) {
  return <span className={`score score-${score >= 9 ? "high" : score >= 7 ? "mid" : "low"}`}><strong>{score}</strong><small>/12</small></span>;
}

function Topbar({ title, subtitle, dark, setDark }: { title: string; subtitle: string; dark: boolean; setDark: (v: boolean) => void }) {
  return (
    <header className="topbar">
      <div><div className="eyebrow">PAINFINDER / {title}</div><h1>{title}</h1><p>{subtitle}</p></div>
      <div className="top-actions">
        <span className="live-dot"><i /> 파이프라인 정상</span>
        <button className="icon-button" onClick={() => setDark(!dark)} aria-label="테마 전환">{dark ? "☀" : "◐"}</button>
        <button className="avatar" aria-label="개인 설정">JN</button>
      </div>
    </header>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("today");
  const [dark, setDark] = useState(true);
  const [items, setItems] = useState(CANDIDATES);
  const [selectedId, setSelectedId] = useState(1);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("전체 소스");
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);
  const visible = useMemo(() => items.filter(item =>
    (sourceFilter === "전체 소스" || item.source === sourceFilter) &&
    (item.summary.includes(search) || item.domain.includes(search) || item.who.includes(search))
  ), [items, search, sourceFilter]);
  const selected = items.find(i => i.id === selectedId) ?? items[0];

  const decide = (decision: Decision) => {
    setItems(prev => prev.map(item => item.id === selectedId ? { ...item, decision } : item));
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
      if (event.key === "Enter") window.open(selected.url, "_blank", "noopener,noreferrer");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, visible, selectedId, selected.url]);

  const titles: Record<View, [string, string]> = {
    today: ["오늘의 후보", "경쟁 검증을 통과한 신호부터 검토하세요."],
    signals: ["반복 신호", "서로 다른 시점과 출처에서 다시 나타난 문제입니다."],
    settings: ["실행 설정", "수집 범위, 모델, 비용 상한을 프리셋별로 관리합니다."],
    archive: ["보류함", "판단 기준이 바뀌면 언제든 다시 검토할 수 있습니다."],
    logs: ["실행 로그", "어디서 걸러졌고 왜 멈췄는지 숨김없이 보여줍니다."],
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("today")} aria-label="Painfinder 홈"><span className="brand-mark">P</span><span>PAIN<strong>FINDER</strong><small>RESEARCH CONSOLE</small></span></button>
        <nav aria-label="주요 메뉴">
          {NAV.map(n => <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => setView(n.id)}><b>{n.mark}</b><span>{n.label}</span>{n.count && <em>{n.count}</em>}</button>)}
        </nav>
        <div className="sidebar-run">
          <div><span>오늘 비용</span><strong>$0.84 / $3.00</strong></div>
          <div className="meter"><i style={{ width: "28%" }} /></div>
          <button onClick={() => setView("settings")}><span>▶</span> 지금 실행</button>
        </div>
        <div className="shortcut-legend"><p>KEYBOARD</p><div><kbd>J</kbd><kbd>K</kbd><span>이동</span></div><div><kbd>T</kbd><span>추적</span><kbd>H</kbd><span>보류</span></div><div><kbd>X</kbd><span>기각</span><kbd>↵</kbd><span>원문</span></div></div>
      </aside>

      <section className="workspace">
        <Topbar title={titles[view][0]} subtitle={titles[view][1]} dark={dark} setDark={setDark} />
        {view === "today" && <TodayView visible={visible} selected={selected} setSelectedId={setSelectedId} search={search} setSearch={setSearch} sourceFilter={sourceFilter} setSourceFilter={setSourceFilter} onDecision={decide} rejecting={rejecting} setRejecting={setRejecting} rejectReason={rejectReason} setRejectReason={setRejectReason} />}
        {view === "signals" && <SignalsView onOpen={(id) => { setSelectedId(id); setView("today"); }} />}
        {view === "settings" && <SettingsView />}
        {view === "archive" && <ArchiveView items={items} onRestore={(id) => { setSelectedId(id); setView("today"); }} />}
        {view === "logs" && <LogsView />}
      </section>

      <nav className="mobile-nav" aria-label="모바일 메뉴">{NAV.map(n => <button key={n.id} onClick={() => setView(n.id)} className={view === n.id ? "active" : ""}><b>{n.mark}</b><span>{n.label.replace("오늘의 ", "")}</span></button>)}</nav>
    </main>
  );
}

function TodayView({ visible, selected, setSelectedId, search, setSearch, sourceFilter, setSourceFilter, onDecision, rejecting, setRejecting, rejectReason, setRejectReason }: {
  visible: Candidate[]; selected: Candidate; setSelectedId: (id: number) => void; search: string; setSearch: (v: string) => void; sourceFilter: string; setSourceFilter: (v: string) => void; onDecision: (d: Decision) => void; rejecting: boolean; setRejecting: (v: boolean) => void; rejectReason: string; setRejectReason: (v: string) => void;
}) {
  return <div className="today-layout">
    <section className="candidate-pane">
      <div className="stat-strip">
        <div><span>신규 후보</span><strong>12</strong><small>+4 어제 대비</small></div>
        <div><span>검증 대기</span><strong>07</strong><small>오늘 처리</small></div>
        <div><span>반복 신호</span><strong>05</strong><small className="good">↑ 2 증가</small></div>
        <div><span>기각률</span><strong>68%</strong><small>최근 30일</small></div>
      </div>
      <div className="filter-row">
        <label className="searchbox"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="후보 검색" /></label>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} aria-label="소스 필터"><option>전체 소스</option><option>네이버 카페</option><option>지식iN</option><option>네이버 블로그</option><option>앱 리뷰</option><option>Threads</option></select>
        <button className="filter-button">점수 높은 순 ↕</button>
      </div>
      <div className="list-head"><span>후보 {visible.length}건</span><small>최근 실행 · 17:04</small></div>
      <div className="candidate-list">
        {visible.map(item => <button key={item.id} className={`candidate-row ${selected.id === item.id ? "selected" : ""}`} onClick={() => setSelectedId(item.id)}>
          <div className="row-status"><i className={`status-dot ${item.decision}`} /><ScoreGauge score={item.score} /></div>
          <div className="row-main"><h3>{item.summary}</h3><div><span className={`source-tag ${item.sourceTone}`}>{item.source}</span><span>{item.domain}</span><span>{item.time}</span>{item.recurrence >= 3 && <span className="repeat-tag">↻ {item.recurrence}회 반복</span>}</div></div>
          <div className="row-rival"><strong>{item.competitors}</strong><span>경쟁자</span></div>
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
        <section className="detail-section analysis"><header><h3>LLM 분석</h3><span>HAIKU · 1.2s</span></header><dl><div><dt>누가</dt><dd>{selected.who}</dd></div><div><dt>현재 우회 수단</dt><dd>{selected.workaround}</dd></div><div><dt>신호 유형</dt><dd><span className="amber-text">{selected.signal}</span> · {selected.frequency}</dd></div><div><dt>지불 신호</dt><dd>{selected.money ? `“${selected.money}”` : <span className="muted">명시적 신호 없음</span>}</dd></div></dl></section>
        <section className="detail-section competitors"><header><h3>경쟁 검증 <b>{selected.rivals.length}</b></h3><span className={selected.rivals.length === 0 ? "warn" : "verified"}>{selected.rivals.length === 0 ? "⚠ 빈 시장 경계" : "✓ 검색 완료"}</span></header>
          {selected.rivals.length ? <div className="rival-list">{selected.rivals.map(r => <a key={r.name} href={`https://www.google.com/search?q=${encodeURIComponent(r.name)}`} target="_blank" rel="noreferrer"><i className={`rival-state ${r.state}`} /> <strong>{r.name}</strong><span>{r.pricing}</span><p>{r.note}</p><em>↗</em></a>)}</div> : <div className="zero-rivals"><strong>찾은 경쟁자가 없습니다.</strong><p>자동 합격이 아닙니다. 수요가 형성되지 않은 시장일 수 있어 직접 확인이 필요합니다.</p></div>}
        </section>
        <section className="detail-section scorecard"><header><h3>6개 필터</h3><span>{selected.score} / 12점</span></header><div className="score-grid">{selected.scores.map(s => <div key={s.label}><span>{s.label}</span><div className="score-track"><i style={{ width: `${s.value * 50}%` }} /></div><b>{s.value}</b></div>)}</div><div className={`access-flag ${selected.access ? "stable" : "unstable"}`}><span>{selected.access ? "✓" : "!"}</span><div><strong>데이터 접근 {selected.access ? "안정" : "불안정"}</strong><small>{selected.access ? "공식 API 또는 공개 데이터 확인" : "공식 API가 없어 별도 검토 필요"}</small></div></div></section>
      </div>
      <div className="decision-bar">
        {rejecting ? <div className="reject-form"><input autoFocus value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="기각 사유를 입력하세요" /><button onClick={() => onDecision("rejected")} disabled={!rejectReason.trim()}>기각 확정</button><button onClick={() => setRejecting(false)}>취소</button></div> : <><button className="track" onClick={() => onDecision("tracking")}><kbd>T</kbd> 추적</button><button onClick={() => onDecision("holding")}><kbd>H</kbd> 보류</button><button className="reject" onClick={() => setRejecting(true)}><kbd>X</kbd> 기각</button></>}
      </div>
    </aside>
  </div>;
}

function SignalsView({ onOpen }: { onOpen: (id: number) => void }) {
  const clusters = [
    { id: 3, title: "오픈마켓별 반품 데이터 통합", count: 5, span: "41일", sources: ["앱 리뷰", "카페", "블로그"], trend: [2, 3, 2, 5, 4, 7, 9], note: "서로 다른 판매자 5명이 같은 CSV 병합 작업을 언급" },
    { id: 1, title: "소규모 제조업 HACCP 이중 기록", count: 4, span: "73일", sources: ["카페", "지식iN"], trend: [1, 2, 1, 3, 2, 4, 6], note: "20인 이하 공장에서 반복. 기존 솔루션 가격이 공통 장애물" },
    { id: 2, title: "학원 보강 일정 다자간 조율", count: 3, span: "28일", sources: ["지식iN", "카페"], trend: [0, 1, 1, 2, 2, 3, 4], note: "학부모 카톡과 엑셀을 함께 쓰는 패턴이 일치" },
    { id: 6, title: "건축 현장 사진 메타데이터 유실", count: 3, span: "19일", sources: ["Threads", "블로그"], trend: [1, 0, 2, 1, 3, 2, 5], note: "카톡 수신 과정에서 촬영 위치·공정 정보가 사라짐" },
  ];
  return <div className="page-pad"><div className="signal-toolbar"><div className="insight"><span>↻</span><div><strong>반복은 의견보다 강합니다.</strong><p>다른 사람이, 다른 날, 다른 곳에서 같은 문제를 말하면 제품 후보로 올라옵니다.</p></div></div><button>카운트 높은 순 ↕</button></div><div className="cluster-list">{clusters.map((c, idx) => <button key={c.title} className="cluster" onClick={() => onOpen(c.id)}><div className="cluster-rank">0{idx + 1}</div><div className="cluster-copy"><div><span className="cluster-count">{c.count}회 반복</span><span>{c.span} 동안</span></div><h2>{c.title}</h2><p>{c.note}</p><div className="cluster-sources">{c.sources.map(s => <i key={s}>{s}</i>)}</div></div><div className="spark" aria-label="최근 발생 추이">{c.trend.map((v, i) => <i key={i} style={{ height: `${10 + v * 6}px` }} />)}</div><span className="cluster-arrow">→</span></button>)}</div></div>;
}

const INITIAL_FAMILIES: Array<{ name: string; weight: number; active: boolean }> = [
  ["workaround", 30, true], ["question", 30, true], ["seeking", 20, true],
  ["emotion", 0, false], ["giveup", 10, true], ["request", 10, true],
].map(([name, weight, active]) => ({ name: String(name), weight: Number(weight), active: Boolean(active) }));

function SettingsView() {
  const [preset, setPreset] = useState("자영업 탐색");
  const [mode, setMode] = useState(70);
  const [families, setFamilies] = useState(INITIAL_FAMILIES);
  const [sources, setSources] = useState(["네이버카페", "지식iN", "블로그", "앱리뷰"]);
  const [domains, setDomains] = useState(["자영업", "식품 제조", "교육", "이커머스"]);
  const [domainInput, setDomainInput] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saved, setSaved] = useState(false);
  const [runMessage, setRunMessage] = useState("");
  const configBody = () => ({
    name: preset,
    mode_ratio: mode,
    families: Object.fromEntries(families.map(f => [f.name, f.active ? f.weight : 0])),
    domains,
    sources: Object.fromEntries(sources.map(source => [source, true])),
    period_days: 7,
    limits: { queries: 20, itemsPerSource: 500, dailyCostUsd: 3 },
  });
  const startRun = async () => {
    setRunning(true); setProgress(8); setRunMessage("파이프라인을 시작하는 중");
    const timer = window.setInterval(() => setProgress(p => Math.min(86, p + 5)), 450);
    try {
      const response = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configBody()) });
      const result = await response.json() as { mode?: string; error?: string; stageCounts?: { collected?: number; llm2Analyzed?: number } };
      if (!response.ok) throw new Error(result.error ?? "실행 실패");
      setProgress(100);
      setRunMessage(result.mode === "demo" ? "데모 실행 완료 · API 키 연결 시 실수집 시작" : `실행 완료 · ${result.stageCounts?.collected ?? 0}건 수집 / ${result.stageCounts?.llm2Analyzed ?? 0}건 분석`);
    } catch (error) { setRunMessage(error instanceof Error ? error.message : "실행 실패"); }
    finally { window.clearInterval(timer); setRunning(false); }
  };
  const saveConfig = async () => {
    setSaved(false);
    try { await fetch("/api/configs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configBody()) }); setSaved(true); }
    finally { window.setTimeout(() => setSaved(false), 1500); }
  };
  const toggleSource = (source: string) => setSources(s => s.includes(source) ? s.filter(x => x !== source) : [...s, source]);
  return <div className="settings-wrap">
    <div className="preset-bar"><div><label>실행 프리셋</label><select value={preset} onChange={e => setPreset(e.target.value)}><option>자영업 탐색</option><option>개발자 도구</option><option>전체 훑기</option></select></div><button>＋ 새 프리셋</button><span>마지막 저장 · 오늘 16:42</span></div>
    <div className="settings-grid">
      <section className="setting-card model-card"><header><span>01</span><div><h2>모델</h2><p>단계별 속도와 분석 깊이를 선택합니다.</p></div><strong>예상 $0.72 / 회</strong></header><div className="model-rows">{[["1차 판정", "Haiku", "$0.12"], ["2차 분석", "Haiku", "$0.20"], ["경쟁 검증", "Sonnet", "$0.40"]].map(row => <label key={row[0]}><span>{row[0]}</span><select defaultValue={row[1]}><option>Haiku</option><option>Sonnet 5</option></select><small>{row[2]}</small></label>)}</div></section>
      <section className="setting-card mode-card"><header><span>02</span><div><h2>수집 모드</h2><p>재현율과 비용 사이의 균형을 정합니다.</p></div></header><div className="mode-copy"><div><strong>정밀 모드</strong><p>키워드 기반 · 저비용</p></div><b>{mode} : {100 - mode}</b><div><strong>탐색 모드</strong><p>무차별 수집 · 고비용</p></div></div><input type="range" min="0" max="100" value={mode} onChange={e => setMode(Number(e.target.value))} /><div className="mode-scale"><span>정밀 {mode}%</span><span>탐색 {100 - mode}%</span></div>{100 - mode > 40 && <p className="cost-warning">탐색 비중이 높습니다. 예상 비용이 약 34% 증가합니다.</p>}</section>
      <section className="setting-card family-card"><header><span>03</span><div><h2>쿼리 패밀리</h2><p>사람이 만든 쿼리만 라운드로빈으로 사용합니다.</p></div><small>합계 {families.filter(f => f.active).reduce((s, f) => s + f.weight, 0)}%</small></header><div className="family-list">{families.map((f, idx) => <div key={f.name} className={!f.active ? "disabled" : ""}><label className="check"><input type="checkbox" checked={f.active} onChange={() => setFamilies(list => list.map((x, i) => i === idx ? { ...x, active: !x.active } : x))} /><i /> <strong>{f.name}</strong></label><input type="range" min="0" max="50" step="5" value={f.weight} disabled={!f.active} onChange={e => setFamilies(list => list.map((x, i) => i === idx ? { ...x, weight: Number(e.target.value) } : x))} /><b>{f.active ? f.weight : 0}%</b></div>)}</div></section>
      <section className="setting-card search-card"><header><span>04</span><div><h2>검색 영역</h2><p>관심 업종과 데이터 소스를 제한합니다.</p></div></header><label className="field-label">도메인 / 업종</label><div className="tag-input">{domains.map(d => <span key={d}>{d}<button onClick={() => setDomains(domains.filter(x => x !== d))}>×</button></span>)}<input value={domainInput} onChange={e => setDomainInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && domainInput.trim()) { setDomains([...domains, domainInput.trim()]); setDomainInput(""); } }} placeholder="입력 후 Enter" /></div><label className="field-label">소스</label><div className="source-options">{["네이버카페", "지식iN", "블로그", "웹문서", "Threads", "앱리뷰", "HN"].map(s => <button key={s} className={sources.includes(s) ? "on" : ""} onClick={() => toggleSource(s)}><i />{s}{s === "Threads" && <em>승인 필요</em>}</button>)}</div><div className="mini-fields"><label>기간<select defaultValue="7"><option value="7">최근 7일</option><option value="30">최근 30일</option><option value="90">최근 90일</option></select></label><label>앱 목록<button>4개 앱 관리 →</button></label></div></section>
      <section className="setting-card limit-card"><header><span>05</span><div><h2>하드 상한</h2><p>예상 밖의 폭주를 코드와 설정에서 이중 차단합니다.</p></div></header><div className="limit-grid"><label>1회 쿼리 수<div><input type="number" defaultValue="20" /><span>최대 50</span></div></label><label>소스별 수집 상한<div><input type="number" defaultValue="500" /><span>건</span></div></label><label>일일 비용 상한<div><b>$</b><input type="number" defaultValue="3" /><span>최대 $10</span></div></label></div><p className="limit-note"><span>!</span> 상한 도달 시 실행을 즉시 중단하고 로그에 이유를 남깁니다.</p></section>
    </div>
    <div className="settings-footer"><div>{progress > 0 && <><span>{running ? `파이프라인 실행 중 · ${progress}%` : runMessage}</span><div className="run-progress"><i style={{ width: `${progress}%` }} /></div></>}</div><button className="secondary" onClick={saveConfig}>{saved ? "✓ 저장됨" : "설정 저장"}</button><button className="primary" onClick={startRun} disabled={running}>{running ? `${progress}% 처리 중` : "▶ 지금 실행"}</button></div>
  </div>;
}

function ArchiveView({ items, onRestore }: { items: Candidate[]; onRestore: (id: number) => void }) {
  const archived = items.filter(i => i.decision === "holding" || i.decision === "rejected");
  const [tab, setTab] = useState<"all" | Decision>("all");
  const shown = tab === "all" ? archived : archived.filter(i => i.decision === tab);
  return <div className="page-pad"><div className="archive-tools"><div className="tabs"><button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>전체 {archived.length}</button><button className={tab === "holding" ? "active" : ""} onClick={() => setTab("holding")}>보류 {archived.filter(i => i.decision === "holding").length}</button><button className={tab === "rejected" ? "active" : ""} onClick={() => setTab("rejected")}>기각 {archived.filter(i => i.decision === "rejected").length}</button></div><label className="searchbox"><span>⌕</span><input placeholder="보류함 검색" /></label></div><div className="archive-table"><div className="archive-head"><span>상태</span><span>후보</span><span>점수</span><span>사유</span><span>판정일</span><span /></div>{shown.map(i => <div className="archive-row" key={i.id}><span className={`status-label ${i.decision}`}>{STATUS_LABEL[i.decision]}</span><div><strong>{i.summary}</strong><small>{i.source} · {i.domain}</small></div><ScoreGauge score={i.score} /><p>{i.decision === "rejected" ? "무료 대안이 충분하고 지불 신호 없음" : "데이터 접근 안정성 확인 필요"}</p><time>오늘</time><button onClick={() => onRestore(i.id)}>다시 검토 →</button></div>)}</div></div>;
}

function LogsView() {
  const runs = [
    { date: "오늘 17:04", preset: "자영업 탐색", start: 864, rule: 641, llm1: 88, llm2: 34, verify: 12, cost: "$0.84", status: "완료", note: "" },
    { date: "어제 08:00", preset: "전체 훑기", start: 1200, rule: 933, llm1: 124, llm2: 40, verify: 20, cost: "$3.00", status: "상한 중단", note: "일일 비용 상한 $3.00 도달" },
    { date: "7월 20일 08:00", preset: "개발자 도구", start: 524, rule: 418, llm1: 62, llm2: 28, verify: 15, cost: "$1.12", status: "완료", note: "" },
  ];
  const [active, setActive] = useState(0);
  const run = runs[active];
  const funnel = [["수집", run.start], ["룰 통과", run.rule], ["1차 통과", run.llm1], ["2차 분석", run.llm2], ["검증 완료", run.verify]] as const;
  return <div className="logs-layout"><aside className="run-list"><div className="run-list-head">최근 실행 <span>12회</span></div>{runs.map((r, i) => <button key={r.date} className={active === i ? "active" : ""} onClick={() => setActive(i)}><div><strong>{r.date}</strong><span className={r.status === "완료" ? "done" : "stopped"}>{r.status}</span></div><p>{r.preset}</p><small>{r.start.toLocaleString()}건 수집 · {r.cost}</small></button>)}</aside><section className="run-detail"><div className="run-summary"><div><span>RUN / 2026-07-{22 - active}</span><h2>{run.preset}</h2><p>{run.date} · 6분 42초</p></div><div><span>추정 비용</span><strong>{run.cost}</strong><small>LLM 67회 호출</small></div><button>로그 내보내기 ↓</button></div>{run.note && <div className="stop-alert"><span>!</span><div><strong>상한에 의해 중단됨</strong><p>{run.note}. 수집된 데이터는 보존되며 다음 실행에서 이어집니다.</p></div></div>}<section className="funnel-section"><header><h3>단계별 통과</h3><span>수집 대비 최종 {((run.verify / run.start) * 100).toFixed(1)}%</span></header><div className="funnel">{funnel.map(([label, value], i) => <div key={label} style={{ width: `${100 - i * 13}%` }}><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{i === 0 ? "100%" : `${((value / run.start) * 100).toFixed(1)}%`}</small></div>)}</div></section><div className="log-metrics"><div><span>LLM 1차</span><strong>44</strong><small>재시도 1</small></div><div><span>LLM 2차</span><strong>18</strong><small>실패 0</small></div><div><span>검증 검색</span><strong>05</strong><small>평균 1.8초</small></div><div><span>에러</span><strong>01</strong><small>복구됨</small></div></div><section className="error-log"><header><h3>이벤트 로그</h3><button>전체 보기</button></header><div><time>17:08:31</time><span className="warn-pill">WARN</span><p>네이버 webkr 응답 지연 · 1회 재시도 후 정상 처리</p></div><div><time>17:10:42</time><span className="info-pill">INFO</span><p>경쟁 검증 12건 완료 · 유료 결제 신호 7건</p></div></section></section></div>;
}
