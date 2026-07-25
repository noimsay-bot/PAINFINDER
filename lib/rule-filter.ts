export type FinalRejectReason = "구직" | "구매문의" | "신체" | "일회성" | "정보질문" | "학습" | "제외키워드" | "제외도메인";

export type RuleExclusion = {
  kind: "keyword" | "domain";
  value: string;
};

export type RuleGateInput = {
  title: string;
  body: string;
  summary?: string;
  domain?: string;
};

const BUILTIN_RULES: Array<{ reason: FinalRejectReason; pattern: RegExp }> = [
  {
    reason: "구직",
    pattern: /구인|구직|채용\s*공고|이직|자기소개서|이력서|면접|합격\s*수기|일자리\s*(구하|찾)|배송\s*자리|자리\s*(구하|배정)|기사\s*모집|알바\s*(구하|지원)/i,
  },
  {
    reason: "구매문의",
    pattern: /어디서\s*(사|구매)|최저가|소량\s*(구매|판매)|구매\s*문의|판매\s*문의|배송\s*문의|재고\s*문의|\d+\s*(개|마리|박스|세트)\s*단위|당구\s*큐대|큐대\s*(왁스|코팅|마찰)/i,
  },
  {
    reason: "신체",
    pattern: /(목|어깨|허리).{0,18}(통증|아프|아파|뻐근|결림)|눈\s*(피로|아픔|통증)|거북목|손목\s*(통증|아픔)|신체\s*통증/i,
  },
  {
    reason: "일회성",
    pattern: /신사업장|사업장\s*이전|이전\s*과정|주차\s*(문제|불만)|식대\s*(상승|불만)|특정\s*날짜|예식|결혼식|신부\s*(계단\s*)?입장|버진로드|음원\s*편집\s*(길이|시간)/i,
  },
  {
    reason: "학습",
    pattern: /자격증|합격\s*수기|강의\s*(후기|수강)|과제\s*(제출|제작)|공부\s*(방법|시작)|시험\s*(준비|공부)/i,
  },
  {
    reason: "정보질문",
    pattern: /뜻이\s*뭔가|정의가\s*무엇|단순\s*정보\s*질문|알려\s*주세요\s*[?.!]*$/i,
  },
];

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR");
}

export function classifyFinalRuleRejection(input: RuleGateInput, exclusions: RuleExclusion[] = []): FinalRejectReason | null {
  const text = normalize(`${input.title} ${input.body} ${input.summary ?? ""}`);
  const domain = normalize(input.domain ?? "");

  for (const exclusion of exclusions) {
    const value = normalize(exclusion.value);
    if (!value) continue;
    if (exclusion.kind === "domain" && (domain === value || domain.includes(value))) return "제외도메인";
    if (exclusion.kind === "keyword" && text.includes(value)) return "제외키워드";
  }
  return BUILTIN_RULES.find(rule => rule.pattern.test(text))?.reason ?? null;
}

const SUGGESTION_PATTERNS = [
  /구인|구직|채용|이직|일자리|배송\s*자리|기사\s*모집/gi,
  /소량\s*구매|최저가|구매\s*문의|배송\s*문의|재고\s*문의|\d+\s*(?:개|마리|박스|세트)(?:\s*단위)?/gi,
  /목\s*통증|어깨\s*통증|허리\s*통증|눈\s*피로|거북목|손목\s*통증/gi,
  /신사업장|사업장\s*이전|주차\s*문제|식대\s*상승|예식|버진로드|음원\s*편집/gi,
  /자격증|합격\s*수기|강의\s*후기|과제\s*제작/gi,
];

const SUGGESTION_STOPWORDS = new Set([
  "그리고", "하지만", "그래서", "관련", "문제", "문의", "방법", "어떻게", "합니다", "있습니다",
  "없습니다", "때문에", "정말", "그냥", "이런", "저런", "대한", "위해서", "하는", "되는",
  "사용", "업무", "작업", "관리", "불편", "어려움", "사람", "경우", "현재", "이번",
]);

export function extractRuleSuggestionTerms(text: string) {
  const knownMatches = SUGGESTION_PATTERNS.flatMap(pattern => text.match(pattern) ?? []);
  const nounLike = text.match(/[가-힣A-Za-z][가-힣A-Za-z0-9·_-]{2,14}/g) ?? [];
  const normalized = [...knownMatches, ...nounLike]
    .map(value => value.replace(/\s+/g, " ").trim())
    .filter(value => value.length >= 2 && !SUGGESTION_STOPWORDS.has(value) && !/(했습니다|입니다|합니다|있어요|없어요)$/.test(value));
  return [...new Set(normalized)].slice(0, 8);
}
