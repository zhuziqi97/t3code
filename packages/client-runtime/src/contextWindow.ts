import type { ThreadStructure } from "./state/shell.ts";
import type {
  OrchestrationV2ProviderTurn,
  OrchestrationV2ProviderTurnTokenUsage,
  OrchestrationV2ProviderThread,
} from "@t3tools/contracts";
import {
  deriveLatestContextWindowSnapshot,
  type ContextWindowSnapshot,
} from "./state/contextWindow.ts";

export { deriveLatestContextWindowSnapshot, type ContextWindowSnapshot };

export function deriveThreadContextWindowSnapshot(
  projection: ThreadStructure | null | undefined,
): ContextWindowSnapshot | null {
  if (!projection) return null;
  const providerThread = projection.providerThreads.find(
    (thread) => thread.id === projection.thread.activeProviderThreadId,
  );
  return deriveLatestContextWindowSnapshot(
    projection.thread.activeProviderThreadId === null
      ? []
      : projection.visibleTurnItems.filter(
          ({ item }) => item.providerThreadId === projection.thread.activeProviderThreadId,
        ),
    latestProviderTurnTokenUsage(projection.providerTurns, projection, providerThread),
    providerThread,
  );
}

export function formatContextWindowPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value < 10 ? `${value.toFixed(1).replace(/\.0$/, "")}%` : `${Math.round(value)}%`;
}

/** Snapshots retain former provider sessions; only the active session reports current occupancy. */
export function latestProviderTurnTokenUsage(
  turns: ReadonlyArray<Pick<OrchestrationV2ProviderTurn, "providerThreadId" | "tokenUsage">>,
  projection?: Pick<ThreadStructure, "thread" | "contextTransfers"> | null,
  providerThread?: Pick<OrchestrationV2ProviderThread, "contextUsage"> | null,
): OrchestrationV2ProviderTurnTokenUsage | null {
  let latest: OrchestrationV2ProviderTurnTokenUsage | null = null;
  for (const { providerThreadId, tokenUsage } of turns) {
    if (
      tokenUsage === undefined ||
      (projection != null && providerThreadId !== projection.thread.activeProviderThreadId)
    )
      continue;
    // Ties go to the later entry, since live upserts append.
    if (latest === null || Date.parse(tokenUsage.updatedAt) >= Date.parse(latest.updatedAt)) {
      latest = tokenUsage;
    }
  }
  if (latest !== null || projection == null || providerThread?.contextUsage != null) return latest;
  const forkedFrom = projection.thread.forkedFrom;
  if (forkedFrom?.type !== "run") return null;
  return (
    projection.contextTransfers.find(
      (transfer) =>
        transfer.type === "fork" &&
        transfer.targetThreadId === projection.thread.id &&
        transfer.sourceThreadId === forkedFrom.threadId &&
        transfer.sourcePoint.runId === forkedFrom.runId &&
        transfer.sourceProviderInstanceId === projection.thread.modelSelection.instanceId &&
        (transfer.status === "pending" || transfer.resolution?.strategy === "native_fork"),
    )?.sourceTokenUsage ?? null
  );
}

export function formatContextWindowTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    // oxlint-disable-next-line t3code/no-em-dash-copy -- A dash represents missing numeric data, not prose.
    return "—";
  }
  if (value < 1_000) {
    return `${Math.round(value)}`;
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (value < 999_500) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}
