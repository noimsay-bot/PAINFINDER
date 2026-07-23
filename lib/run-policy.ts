import { MANUAL_RUN_LIMITS } from "./limits";
import type { RunConfig } from "./pipeline";

export function applyManualRunLimits(config: RunConfig, queries: string[]) {
  const sourceEntries = Object.entries(config.sources ?? {
    naverCafe: true,
    naverKin: true,
    naverBlog: true,
  }).filter(([, enabled]) => enabled);
  const selectedSources = sourceEntries.slice(0, MANUAL_RUN_LIMITS.MAX_SOURCES);
  const requestedItems = config.limits?.itemsPerSource ?? MANUAL_RUN_LIMITS.ITEMS_PER_SOURCE;

  return {
    config: {
      ...config,
      queries: queries.slice(0, MANUAL_RUN_LIMITS.MAX_QUERIES),
      sources: Object.fromEntries(selectedSources),
      auto_verify_top_n: Math.min(
        config.auto_verify_top_n ?? MANUAL_RUN_LIMITS.AUTO_VERIFY_TOP_N,
        MANUAL_RUN_LIMITS.AUTO_VERIFY_TOP_N,
      ),
      limits: {
        ...config.limits,
        queries: Math.max(1, Math.min(queries.length, MANUAL_RUN_LIMITS.MAX_QUERIES)),
        itemsPerSource: Math.max(1, Math.min(requestedItems, MANUAL_RUN_LIMITS.ITEMS_PER_SOURCE)),
      },
    } satisfies RunConfig,
    requestedSourceCount: sourceEntries.length,
    executedSourceCount: selectedSources.length,
  };
}
