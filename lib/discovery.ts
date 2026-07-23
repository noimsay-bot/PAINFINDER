export type CafeRankingRow = {
  cafeId: string;
  collected: number;
  passed: number;
  passRate: number;
};

export type IndustryTranslation = {
  roles: string[];
  tools: string[];
  tasks: string[];
};

export const ACTIVE_KSIC_SECTIONS = ["G", "H", "I", "J", "K", "L", "M", "N", "P", "Q", "R", "S"] as const;

const ACTIVE_SECTION_SET = new Set<string>(ACTIVE_KSIC_SECTIONS);

const PHYSICAL_WORK_PATTERN = /발골|필렛|도축|절단|재단|자르|썰기|깎기|포장|운반|상하차|적재|세척|용접|조립|굴착|타설|생산\s*작업|가공\s*작업|기계\s*조작|장비\s*점검|지게차|도축칼|절단기|세척기|용접기|드릴|전동톱|물리\s*장비|산업용\s*기계/i;

export function ksicSection(code: string) {
  if (code.startsWith("CAFE:")) return "CUSTOM";
  const division = Number(code.slice(0, 2));
  if (!Number.isFinite(division)) return null;
  if (division <= 3) return "A";
  if (division <= 8) return "B";
  if (division <= 34) return "C";
  if (division === 35) return "D";
  if (division <= 39) return "E";
  if (division <= 42) return "F";
  if (division <= 47) return "G";
  if (division <= 52) return "H";
  if (division <= 56) return "I";
  if (division <= 63) return "J";
  if (division <= 66) return "K";
  if (division === 68) return "L";
  if (division <= 73) return "M";
  if (division <= 76) return "N";
  if (division <= 84) return "O";
  if (division === 85) return "P";
  if (division <= 87) return "Q";
  if (division <= 91) return "R";
  if (division <= 96) return "S";
  if (division <= 98) return "T";
  return "U";
}

export function isActiveIndustryCode(code: string) {
  const section = ksicSection(code);
  return section === "CUSTOM" || (section !== null && ACTIVE_SECTION_SET.has(section));
}

export function rankCafeStats<T extends CafeRankingRow>(rows: T[]) {
  return [...rows].sort((a, b) =>
    b.passed - a.passed ||
    b.passRate - a.passRate ||
    b.collected - a.collected ||
    a.cafeId.localeCompare(b.cafeId, "ko-KR")
  );
}

export function isSoftwareRelevantVocabulary(term: string) {
  return term.trim().length >= 2 && !PHYSICAL_WORK_PATTERN.test(term);
}

export function sanitizeIndustryTranslation(value: Record<string, unknown>): IndustryTranslation {
  const normalize = (input: unknown) => String(input ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const unique = (items: unknown[], filterPhysical: boolean) => [...new Set(items
    .map(normalize)
    .filter(term => term.length >= 2 && (!filterPhysical || isSoftwareRelevantVocabulary(term))))];
  return {
    roles: unique(Array.isArray(value.roles) ? value.roles : [], false),
    tools: unique(Array.isArray(value.tools) ? value.tools : [], true),
    tasks: unique(Array.isArray(value.tasks) ? value.tasks : [], true),
  };
}
