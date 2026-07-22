import { scoreMarket, type MarketVerdict } from "./competitors";

export type BuyerContext = "business" | "individual_repeated" | "hobby_or_oneoff";

export type FourScores = {
  f1: number;
  f4: number;
  f5: number;
  f6: number;
  total: number;
};

function clamp(value: number, max: number) {
  return Math.min(max, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));
}

export function scorePayment(opts: {
  moneySignal: string | null;
  verdict: MarketVerdict;
  buyerContext: BuyerContext;
}) {
  if (opts.moneySignal || opts.verdict === "paid_exists" || opts.verdict === "crowded") return 3;
  if (opts.buyerContext === "business") return 2;
  if (opts.buyerContext === "individual_repeated") return 1;
  return 0;
}

export function calculateFourScores(opts: {
  aiReplacementScore: number;
  maintenanceScore: number;
  moneySignal: string | null;
  verdict: MarketVerdict;
  buyerContext: BuyerContext;
}): FourScores {
  const f1 = clamp(opts.aiReplacementScore, 2);
  const f4 = scoreMarket(opts.verdict);
  const f5 = scorePayment(opts);
  const f6 = clamp(opts.maintenanceScore, 2);
  return { f1, f4, f5, f6, total: f1 + f4 + f5 + f6 };
}
