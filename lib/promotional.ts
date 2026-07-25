export type PromotionalSignalInput = {
  source: string;
  title: string;
  body: string;
};

export type PromotionalSignalResult = {
  signals: string[];
  productCandidates: string[];
  score: number;
  threshold: number;
  flagged: boolean;
};

const SIGNAL_RULES = [
  { label: "positive_product", weight: 2, pattern: /(?:[가-힣A-Za-z0-9][가-힣A-Za-z0-9._-]{1,30})\s*(?:쓰고\s*나서|사용하고\s*나서|추천(?:해요|합니다)?|덕분에)/i },
  { label: "resolved_now", weight: 2, pattern: /(?:해결(?:했|됐|되었)(?:어요|습니다)?|편해졌(?:어요|습니다)?|이제\s*(?:걱정|문제)\s*없(?:어요|습니다)?)/i },
  { label: "call_to_action", weight: 3, pattern: /(?:링크는?\s*프로필|프로필\s*링크|댓글\s*문의|무료\s*체험|상담\s*신청|쿠폰|할인\s*코드)/i },
  { label: "contact", weight: 3, pattern: /(?:카카오톡|카톡)\s*(?:오픈\s*)?채팅|open\.kakao|(?:전화|연락)(?:번호)?\s*[:：]?\s*\d{2,3}[-.\s]\d{3,4}[-.\s]\d{4}|디엠\s*(?:주세요|문의)/i },
] as const;

const PRODUCT_CONTEXT = [
  /([가-힣A-Za-z0-9][가-힣A-Za-z0-9._-]{1,30})\s*(?:쓰고\s*나서|사용하고\s*나서|추천(?:해요|합니다)?|덕분에)/gi,
  /([가-힣A-Za-z0-9][가-힣A-Za-z0-9._-]{1,30})\s*(?:앱|프로그램|서비스|솔루션)(?:을|를)?\s*(?:쓰|사용|도입)/gi,
] as const;

const PRODUCT_STOPWORDS = new Set([
  "이거", "저거", "그거", "제품", "서비스", "프로그램", "솔루션", "도구", "앱",
  "직접", "제가", "저희가", "요즘", "예전에", "무료", "정말", "이제",
]);

export function extractPromotionalProductNames(text: string) {
  const names: string[] = [];
  for (const pattern of PRODUCT_CONTEXT) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = String(match[1] ?? "").replace(/^[은는이가을를과와]$/, "").trim();
      if (value.length >= 2 && !PRODUCT_STOPWORDS.has(value)) names.push(value);
    }
  }
  return [...new Set(names)].slice(0, 5);
}

const PROMOTIONAL_INDUCEMENT_PATTERNS = [
  /링크는?\s*프로필/gi,
  /프로필\s*링크/gi,
  /댓글\s*문의/gi,
  /무료\s*체험/gi,
  /상담\s*신청/gi,
  /할인\s*코드/gi,
  /오픈\s*채팅/gi,
  /디엠\s*주세요/gi,
] as const;

export function extractPromotionalExclusionTerms(text: string) {
  const products = extractPromotionalProductNames(text);
  const inducements = PROMOTIONAL_INDUCEMENT_PATTERNS.flatMap(pattern => {
    pattern.lastIndex = 0;
    return text.match(pattern) ?? [];
  }).map(value => value.replace(/\s+/g, " ").trim());
  return [...new Set([...products, ...inducements])].filter(value => value.length > 2).slice(0, 8);
}

export function detectPromotionalSignals(input: PromotionalSignalInput): PromotionalSignalResult {
  const text = `${input.title} ${input.body}`.replace(/\s+/g, " ").trim();
  const matched = SIGNAL_RULES.filter(rule => rule.pattern.test(text));
  const score = matched.reduce((sum, rule) => sum + rule.weight, 0);
  const threshold = input.source === "blog" || input.source === "cafearticle" ? 2 : 3;
  return {
    signals: matched.map(rule => rule.label),
    productCandidates: extractPromotionalProductNames(text),
    score,
    threshold,
    flagged: score >= threshold,
  };
}
