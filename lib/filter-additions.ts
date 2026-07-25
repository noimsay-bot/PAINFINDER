import { supabaseRest } from "./pipeline";

export type FilterAdditionKind = "keyword" | "domain";
export type FilterAdditionMode = "auto" | "approved";

type FilterAdditionInput = {
  keyword: string;
  kind: FilterAdditionKind;
  sourceReason: string;
  mode: FilterAdditionMode;
  originPainPointId: string | null;
};

type FilterAdditionRow = {
  id: number;
  keyword: string;
  kind: FilterAdditionKind;
  source_reason: string;
  mode: FilterAdditionMode;
  active: boolean;
};

export async function addActiveFilter(input: FilterAdditionInput) {
  const keyword = input.keyword.replace(/\s+/g, " ").trim().slice(0, 240);
  if (!keyword) return null;
  const rows = await supabaseRest("filter_additions?on_conflict=kind,keyword,mode&select=id,keyword,kind,source_reason,mode,active", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      keyword,
      kind: input.kind,
      source_reason: input.sourceReason,
      mode: input.mode,
      origin_pain_point_id: input.originPainPointId,
      active: true,
      revoked_at: null,
      added_at: new Date().toISOString(),
    }),
  }) as FilterAdditionRow[] | null;
  const existingRules = await supabaseRest(
    `rule_exclusions?kind=eq.${encodeURIComponent(input.kind)}&value=eq.${encodeURIComponent(keyword)}&select=id&limit=1`,
  ) as Array<{ id: number }> | null;
  if (existingRules?.[0]) {
    await supabaseRest(`rule_exclusions?id=eq.${existingRules[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: true }),
    });
  } else {
    await supabaseRest("rule_exclusions", {
      method: "POST",
      body: JSON.stringify({
        kind: input.kind,
        value: keyword,
        source: input.mode === "auto" ? "decision_auto" : "decision_learning",
        active: true,
      }),
    });
  }
  return rows?.[0] ?? null;
}

export async function revokeFilterAddition(id: number) {
  const rows = await supabaseRest(`filter_additions?id=eq.${id}&select=id,keyword,kind,active&limit=1`) as FilterAdditionRow[] | null;
  const row = rows?.[0];
  if (!row) return false;
  await supabaseRest(`filter_additions?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ active: false, revoked_at: new Date().toISOString() }),
  });
  const remaining = await supabaseRest(`filter_additions?kind=eq.${encodeURIComponent(row.kind)}&keyword=eq.${encodeURIComponent(row.keyword)}&active=eq.true&select=id&limit=1`) as Array<{ id: number }> | null;
  if (!remaining?.length) {
    await supabaseRest(`rule_exclusions?kind=eq.${encodeURIComponent(row.kind)}&value=eq.${encodeURIComponent(row.keyword)}&source=in.(decision_auto,decision_learning)`, {
      method: "PATCH",
      body: JSON.stringify({ active: false }),
    });
  }
  return true;
}
