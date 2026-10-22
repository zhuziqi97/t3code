import { describe, expect, it } from "vite-plus/test";
import { OrchestrationV2ProviderTurnTokenUsage } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { formatContextWindowCompactionMessage } from "../components/chat/ContextWindowMeter.logic";
import * as DateTime from "effect/DateTime";
import {
  ContextTransferId,
  NodeId,
  ProviderThreadId,
  ProviderTurnId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { makeThreadProjectionFixture } from "../test-fixtures";
import { shouldOfferResumeCompaction } from "../components/chat/ContextWindowMeter.logic";
import {
  deriveLatestContextWindowSnapshot,
  deriveThreadContextWindowSnapshot,
  formatContextWindowTokens,
  latestProviderTurnTokenUsage,
} from "./contextWindow";

const decodeTokenUsage = Schema.decodeSync(OrchestrationV2ProviderTurnTokenUsage);

describe("V2 context window presentation", () => {
  it("uses retained compaction token data when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      {
        item: {
          id: "compaction-1" as never,
          threadId: "thread-1" as never,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: 1,
          status: "completed",
          title: null,
          startedAt: null,
          completedAt: null,
          updatedAt: DateTime.makeUnsafe("2026-06-20T00:00:00.000Z"),
          type: "compaction",
          driver: null,
          beforeTokenCount: 10_000,
          afterTokenCount: 2_000,
        },
      },
    ]);
    expect(snapshot?.usedTokens).toBe(2_000);
    expect(snapshot?.totalProcessedTokens).toBeNull();
    expect(snapshot?.compactsAutomatically).toBeNull();
  });

  it("keeps unknown usage distinct from a provider-reported zero", () => {
    expect(deriveLatestContextWindowSnapshot([])).toBeNull();
    expect(formatContextWindowTokens(null)).toBe("—");
    expect(
      deriveLatestContextWindowSnapshot(
        [],
        decodeTokenUsage({ usedTokens: 0, updatedAt: "2026-10-23T00:00:00Z" }),
      )?.usedTokens,
    ).toBe(0);
  });

  it("prefers current provider usage and preserves ACP cost", () => {
    const snapshot = deriveLatestContextWindowSnapshot([], undefined, {
      contextUsage: {
        usedTokens: 2_500,
        maxTokens: 10_000,
        cost: { amount: 0.42, currency: "USD" },
      },
      updatedAt: DateTime.makeUnsafe("2026-08-23T00:00:00.000Z"),
    });

    expect(snapshot).toMatchObject({
      usedTokens: 2_500,
      maxTokens: 10_000,
      remainingTokens: 7_500,
      usedPercentage: 25,
      cost: { amount: 0.42, currency: "USD" },
    });
  });

  it.each([0, null])(
    "does not let a former provider session override current usage %s",
    (usedTokens) => {
      const base = makeThreadProjectionFixture();
      const currentId = ProviderThreadId.make("current-native-session");
      const projection = {
        ...base,
        thread: { ...base.thread, activeProviderThreadId: currentId },
        providerThreads: [
          {
            id: currentId,
            driver: ProviderDriverKind.make("codex"),
            providerInstanceId: base.thread.providerInstanceId,
            providerSessionId: null,
            appThreadId: base.thread.id,
            ownerNodeId: null,
            nativeThreadRef: null,
            nativeConversationHeadRef: null,
            status: "idle" as const,
            firstRunOrdinal: null,
            lastRunOrdinal: null,
            handoffIds: [],
            forkedFrom: null,
            pendingBackgroundTasks: [],
            nativeMetadata: null,
            goal: null,
            contextUsage: usedTokens === null ? null : { usedTokens, maxTokens: 200_000 },
            createdAt: base.updatedAt,
            updatedAt: base.updatedAt,
          },
        ],
        providerTurns: [
          {
            id: ProviderTurnId.make("old-native-turn"),
            providerThreadId: ProviderThreadId.make("former-native-session"),
            nodeId: NodeId.make("old-node"),
            runAttemptId: null,
            nativeTurnRef: null,
            ordinal: 1,
            status: "completed" as const,
            startedAt: base.updatedAt,
            completedAt: base.updatedAt,
            tokenUsage: {
              usedTokens: 80_000,
              maxTokens: 100_000,
              updatedAt: "2026-10-23T00:00:00Z",
            },
          },
        ],
      };
      const snapshot = deriveThreadContextWindowSnapshot(projection);
      if (usedTokens === null) expect(snapshot).toBeNull();
      else expect(snapshot).toMatchObject({ usedTokens: 0, usedPercentage: 0, maxTokens: 200_000 });
    },
  );

  it("formats compact token values", () => {
    expect(formatContextWindowTokens(1_500)).toBe("1.5k");
  });

  it.each([
    [999_499, "999k"],
    [999_500, "1m"],
    [999_999, "1m"],
    [1_000_000, "1m"],
    [1_100_000, "1.1m"],
  ])("formats %d tokens as %s at the million boundary", (tokens, expected) => {
    expect(formatContextWindowTokens(tokens)).toBe(expected);
  });
});

describe("live provider-turn usage (#8144)", () => {
  it("prefers the provider's live report over compaction items", () => {
    const usage = decodeTokenUsage({
      usedTokens: 42_000,
      maxTokens: 200_000,
      inputTokens: 40_000,
      outputTokens: 2_000,
      autoCompactThreshold: 150_000,
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    const snapshot = deriveLatestContextWindowSnapshot([], usage);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(42_000);
    expect(snapshot?.maxTokens).toBe(200_000);
    expect(snapshot?.remainingTokens).toBe(158_000);
    expect(snapshot?.usedPercentage).toBe(21);
    expect(snapshot?.autoCompactThreshold).toBe(150_000);
    expect(
      formatContextWindowCompactionMessage("Claude Sonnet 4.6", snapshot?.autoCompactThreshold),
    ).toBe("Compacts automatically at about 150,000 tokens.");
  });

  it("handles a report without a known context window", () => {
    const snapshot = deriveLatestContextWindowSnapshot([], {
      usedTokens: 42_000,
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    expect(snapshot?.maxTokens).toBeNull();
    expect(snapshot?.usedPercentage).toBeNull();
    expect(snapshot?.autoCompactThreshold).toBeNull();
    expect(snapshot?.compactsAutomatically).toBeNull();
    expect(formatContextWindowCompactionMessage(null, snapshot?.autoCompactThreshold)).toBe(
      "Context compacts automatically when needed.",
    );
  });
});

describe("latestProviderTurnTokenUsage", () => {
  it("picks the newest report, not the last turn in snapshot order", () => {
    const usage = (usedTokens: number, updatedAt: string) => ({
      providerThreadId: ProviderThreadId.make("provider-thread"),
      tokenUsage: { usedTokens, updatedAt },
    });
    const latest = latestProviderTurnTokenUsage([
      usage(300_000, "2026-06-20T12:00:00.000Z"),
      { providerThreadId: ProviderThreadId.make("provider-thread") },
      usage(90_000, "2026-06-20T09:00:00.000Z"),
    ]);
    expect(latest?.usedTokens).toBe(300_000);
  });

  const sourceUsage = {
    usedTokens: 513_000,
    maxTokens: 1_000_000,
    promptCacheTtlMs: 5 * 60_000,
    updatedAt: "2026-10-19T12:00:00.000Z",
  };
  function forkProjection() {
    const projection = makeThreadProjectionFixture();
    const sourceThreadId = ThreadId.make("parent");
    const runId = RunId.make("fork-point");
    return {
      thread: {
        ...projection.thread,
        forkedFrom: { type: "run" as const, threadId: sourceThreadId, runId },
      },
      contextTransfers: [
        {
          id: ContextTransferId.make("fork-transfer"),
          type: "fork" as const,
          sourceThreadId,
          targetThreadId: projection.thread.id,
          sourcePoint: { threadId: sourceThreadId, runId },
          basePoint: null,
          sourceProviderInstanceId: projection.thread.modelSelection.instanceId,
          sourceTokenUsage: sourceUsage,
          targetProviderInstanceId: null,
          targetRunId: null,
          status: "pending" as const,
          resolution: null,
          createdBy: "user" as const,
          error: null,
          createdAt: projection.updatedAt,
          updatedAt: projection.updatedAt,
          consumedAt: null,
        },
      ],
    };
  }

  it("restores reported fork usage and clears it when switching to an unknown thread", () => {
    expect(
      deriveThreadContextWindowSnapshot({ ...makeThreadProjectionFixture(), ...forkProjection() })
        ?.usedTokens,
    ).toBe(sourceUsage.usedTokens);
    expect(deriveThreadContextWindowSnapshot(makeThreadProjectionFixture())).toBeNull();
    expect(deriveThreadContextWindowSnapshot(null)).toBeNull();
  });

  it("keeps fork-point context and its cache expiry before the fork reports usage", () => {
    const usage = latestProviderTurnTokenUsage([], forkProjection());
    expect(usage).toEqual(sourceUsage);
    const snapshot = deriveLatestContextWindowSnapshot([], usage);
    expect(snapshot?.usedTokens).toBe(513_000);
    expect(
      shouldOfferResumeCompaction({
        provider: "claudeAgent",
        usedTokens: snapshot?.usedTokens,
        updatedAt: snapshot?.updatedAt,
        promptCacheTtlMs: usage?.promptCacheTtlMs,
        now: "2026-10-19T12:06:00.000Z",
      }),
    ).toBe(true);
  });

  it("replaces inherited usage with the fork's own report", () => {
    const tokenUsage = { usedTokens: 42_000, updatedAt: "2026-10-19T12:10:00.000Z" };
    const projection = forkProjection();
    const providerThreadId = ProviderThreadId.make("target-provider-thread");
    expect(
      latestProviderTurnTokenUsage([{ providerThreadId, tokenUsage }], {
        ...projection,
        thread: { ...projection.thread, activeProviderThreadId: providerThreadId },
      }),
    ).toEqual(tokenUsage);
  });

  it.each([0, 42_000])(
    "prefers target provider-thread usage of %d tokens over inherited usage",
    (usedTokens) => {
      const providerThread = {
        contextUsage: {
          usedTokens,
          maxTokens: 200_000,
          cost: { amount: 0.42, currency: "USD" },
        },
        updatedAt: DateTime.makeUnsafe("2026-10-19T12:10:00.000Z"),
      };
      const usage = latestProviderTurnTokenUsage([], forkProjection(), providerThread);
      const snapshot = deriveLatestContextWindowSnapshot([], usage, providerThread);

      expect(snapshot).toMatchObject({
        usedTokens,
        maxTokens: 200_000,
        cost: { amount: 0.42, currency: "USD" },
        updatedAt: "2026-10-19T12:10:00.000Z",
      });
    },
  );

  it("keeps the fallback after a native fork is consumed", () => {
    const projection = forkProjection();
    const transfer = projection.contextTransfers[0]!;
    expect(
      latestProviderTurnTokenUsage([], {
        ...projection,
        contextTransfers: [
          {
            ...transfer,
            status: "consumed",
            resolution: {
              strategy: "native_fork",
              providerThreadRef: {
                driver: ProviderDriverKind.make("claudeAgent"),
                nativeId: "fork",
                strength: "strong",
              },
            },
          },
        ],
      }),
    ).toEqual(sourceUsage);
  });

  it("does not reuse usage for portable handoffs, different providers, or missing history", () => {
    const projection = forkProjection();
    const transfer = projection.contextTransfers[0]!;
    for (const contextTransfers of [
      [],
      [{ ...transfer, sourceTokenUsage: undefined }],
      [{ ...transfer, status: "resolved_portable" as const }],
      [{ ...transfer, sourceProviderInstanceId: ProviderInstanceId.make("other") }],
      [{ ...transfer, sourcePoint: { ...transfer.sourcePoint, runId: RunId.make("later") } }],
    ]) {
      expect(latestProviderTurnTokenUsage([], { ...projection, contextTransfers })).toBeNull();
    }
  });
});
