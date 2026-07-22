import { NextResponse } from "next/server";
import { buildPrecisionSearchTerms, classifyMarket, mergeProducts, scoreMarket, searchAppMarket, verifyMarket } from "@/lib/competitors";
import { getLlmProvider, resolveLlmModel } from "@/lib/llm";
import { calculateLlmCost } from "@/lib/llm/pricing";
import { supabaseRest } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

type Row = Record<string, unknown>;

function one(value: unknown): Row {
  if (Array.isArray(value)) return (value[0] as Row | undefined) ?? {};
  return (value as Row | null) ?? {};
}

export async function POST(request: Request) {
  const startedAt = new Date().toISOString();
  try {
    const body = await request.json() as { painPointId?: string };
    if (!body.painPointId) return NextResponse.json({ error: "후보 ID가 필요합니다." }, { status: 400 });
    const rows = await supabaseRest(`pain_points?id=eq.${encodeURIComponent(body.painPointId)}&select=id,domain,money_signal,scores(f1,f2,f3,f4,f5,f6,total,data_access_stable,verdict)&limit=1`) as Row[] | null;
    const pain = rows?.[0];
    if (!pain) return NextResponse.json({ error: "후보를 찾지 못했습니다." }, { status: 404 });

    const score = one(pain.scores);
    const domain = String(pain.domain ?? "");
    const appVerification = await searchAppMarket(domain);
    const llm = getLlmProvider();
    const verification = await verifyMarket({
      searchTerms: buildPrecisionSearchTerms(domain),
      llm,
      model: resolveLlmModel(undefined, "stage2"),
      naverClientId: process.env.NAVER_CLIENT_ID,
      naverClientSecret: process.env.NAVER_CLIENT_SECRET,
    });
    const competitors = mergeProducts(appVerification.products, verification.products);
    const verdict = classifyMarket(competitors);
    const f4 = scoreMarket(verdict);
    const f5 = verdict === "paid_exists" || verdict === "crowded" ? 3 : Number(score.f5 ?? 0);
    const verifiedAt = new Date().toISOString();

    await supabaseRest(`competitors?pain_point_id=eq.${encodeURIComponent(body.painPointId)}`, { method: "DELETE" });
    if (competitors.length) await supabaseRest("competitors", { method: "POST", body: JSON.stringify(competitors.map(competitor => ({ ...competitor, pain_point_id: body.painPointId }))) });
    await supabaseRest(`scores?pain_point_id=eq.${encodeURIComponent(body.painPointId)}`, { method: "PATCH", body: JSON.stringify({ f4, f5, verdict }) });
    await supabaseRest(`pain_points?id=eq.${encodeURIComponent(body.painPointId)}`, { method: "PATCH", body: JSON.stringify({ precision_verified_at: verifiedAt }) });

    const usage = verification.usage;
    const cost = usage ? calculateLlmCost(usage.model, usage.inputTokens, usage.outputTokens) ?? 0 : 0;
    const errors = [...appVerification.errors, ...verification.errors];
    await supabaseRest("run_logs", {
      method: "POST",
      body: JSON.stringify({
        started_at: startedAt,
        ended_at: verifiedAt,
        stage_counts: {
          onDemandVerified: 1,
          appVerified: 1,
          competitorProduct: competitors.length,
          competitorAppProduct: appVerification.products.length,
          competitorContent: verification.counts.content,
          competitorIrrelevant: verification.counts.irrelevant,
          competitorUrlExcluded: verification.counts.urlExcluded,
        },
        llm_calls: { verify: usage ? 1 : 0, inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 },
        cost_estimate: Number(cost.toFixed(4)),
        stopped_reason: null,
        errors,
      }),
    });

    return NextResponse.json({ painPointId: body.painPointId, precisionVerifiedAt: verifiedAt, competitors, verdict, scores: { f4, f5 }, errors });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "정밀 검증에 실패했습니다." }, { status: 500 });
  }
}
