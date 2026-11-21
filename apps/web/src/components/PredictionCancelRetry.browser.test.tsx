import "~/index.css";
import * as Effect from "effect/Effect";
import { createMemoryHistory } from "@tanstack/react-router";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  type OrchestrationV2ProviderThread,
  type ComposerPredictionInput,
  WS_METHODS,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily, and its first transform (React Compiler over ~4k lines)
// takes 6-11s; importing it here keeps that out of the test's timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  answerRpc,
  CODEX_PROVIDER,
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it("retries a cancelled native prediction once through Alt+Enter", async () => {
  const instance = ProviderInstanceId.make("codex");
  const driver = ProviderDriverKind.make("codex");
  const stored = { instanceId: instance, model: "gpt-5.4" };
  const thread = threadWithHistory("prediction-model-switch", 1, stored);
  const at = DateTime.makeUnsafe("2026-11-19T02:00:00Z");
  const native: OrchestrationV2ProviderThread = {
    id: ProviderThreadId.make("prediction-native-thread"),
    driver,
    providerInstanceId: instance,
    providerSessionId: null,
    appThreadId: thread.id,
    ownerNodeId: null,
    nativeThreadRef: { driver, nativeId: "prediction-native", strength: "strong" },
    nativeConversationHeadRef: null,
    status: "idle",
    firstRunOrdinal: 1,
    lastRunOrdinal: 1,
    handoffIds: [],
    forkedFrom: null,
    pendingBackgroundTasks: [],
    contextUsage: null,
    nativeMetadata: null,
    goal: null,
    createdAt: at,
    updatedAt: at,
  };
  const requests: ComposerPredictionInput[] = [];
  const firstReply = Promise.withResolvers<void>();
  const fullThread = { ...thread, providerThreads: [native] };
  using _environment = installFakeEnvironment([fullThread], {
    acceptCommands: true,
    providers: [CODEX_PROVIDER],
  });
  using _request = answerRpc(
    WS_METHODS.composerRequestPrediction,
    (input: ComposerPredictionInput) => {
      requests.push(input);
      const resultId = { requestId: input.requestId, sourceRunId: input.sourceRunId };
      if (input.intent === "auto") {
        return Effect.promise(() => firstReply.promise).pipe(
          Effect.as({ ...resultId, status: "cancelled" as const }),
        );
      }
      return Effect.succeed({
        ...resultId,
        status: "suggestion" as const,
        text: "Verify the manual suggestion",
      });
    },
  );
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    languagePreference: "en",
    codexNativePredictions: "auto",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });
  try {
    const pending = page.getByText("Requesting a prediction…", { exact: true }).first();
    await expect.element(pending).toBeVisible();
    expect(requests.map((request) => request.intent)).toEqual(["auto"]);

    firstReply.resolve();
    await expect
      .element(page.getByText("Suggestion cancelled.", { exact: true }).first())
      .toBeVisible();
    await page.getByRole("button", { name: /^GPT-5\.4(?:,|$)/ }).click();
    await userEvent.keyboard("{Alt>}{Enter}{/Alt}");
    await expect
      .element(page.getByText("Verify the manual suggestion", { exact: true }).first())
      .toBeVisible();
    await userEvent.keyboard("{Alt>}{Enter}{/Alt}");
    expect(requests.map((request) => request.intent)).toEqual(["auto", "manual"]);
    expect(requests[1]?.sourceRunId).toBe(requests[0]?.sourceRunId);
    expect(requests[1]?.requestId).not.toBe(requests[0]?.requestId);
  } finally {
    firstReply.resolve();
  }
});
