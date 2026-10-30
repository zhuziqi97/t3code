import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { describe, expect, it } from "vite-plus/test";
import { formatInlineContextReference } from "../../lib/composerContextReferences";
import { threadContextReference } from "../../lib/composerContextRecords";
import { threadContextRecord } from "@t3tools/shared/composerContextReferences";
import {
  approvalRedirectNotice,
  loadBalancingSendWarning,
  multipleModelSendBlock,
  referencedThreadContexts,
} from "./composerSend.logic";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const localThread = threadContextRecord(scopeThreadRef(local, ThreadId.make("a")), "Local");
const remoteThread = threadContextRecord(scopeThreadRef(remote, ThreadId.make("b")), "Remote");

describe("referencedThreadContexts", () => {
  it("keeps only the attached threads the prompt still links", () => {
    const prompt = `see ${formatInlineContextReference(threadContextReference(remoteThread))}`;
    expect(
      referencedThreadContexts({ prompt, threadContexts: [localThread, remoteThread] }),
    ).toEqual([remoteThread]);
  });
});

describe("loadBalancingSendWarning", () => {
  it("asks the user to wait while resource checks run", () => {
    expect(
      loadBalancingSendWarning({
        pending: true,
        threadContexts: [localThread, remoteThread],
        candidateEnvironmentIds: [],
      }).title,
    ).toBe("Checking machine resources");
  });

  it("blames the attached threads when no machine can read all of them", () => {
    expect(
      loadBalancingSendWarning({
        pending: false,
        threadContexts: [localThread, remoteThread],
        candidateEnvironmentIds: [local, remote],
      }).description,
    ).toMatch(/No machine can read every attached thread/);
  });

  it("blames resources when one machine can read every attached thread", () => {
    expect(
      loadBalancingSendWarning({
        pending: false,
        threadContexts: [localThread],
        candidateEnvironmentIds: [remote, local],
      }).description,
    ).toMatch(/No eligible machine has available resources/);
  });
});

describe("multipleModelSendBlock", () => {
  const ready = {
    selectionCount: 2,
    serverSupportsWorktreeBootstrap: true,
    isLocalDraftThread: true,
    isGitRepo: true,
    branch: "main",
  };

  it("lets a new Git draft with a branch and models start", () => {
    expect(multipleModelSendBlock(ready)).toBeNull();
  });

  it("asks for a server update before checking the draft", () => {
    expect(
      multipleModelSendBlock({
        ...ready,
        serverSupportsWorktreeBootstrap: false,
        isGitRepo: false,
      }),
    ).toBe("server-outdated");
  });

  it.each([
    { isLocalDraftThread: false },
    { isGitRepo: false },
    { branch: null },
    { selectionCount: 0 },
  ])("needs a new Git thread with a branch and models (%o)", (override) => {
    expect(multipleModelSendBlock({ ...ready, ...override })).toBe("needs-new-git-thread");
  });
});

describe("approvalRedirectNotice", () => {
  const settled = {
    draftChanged: false,
    declined: true,
    approvalResponding: false,
    approvalArrived: false,
  };

  it("says the decline went through when the draft changed after it", () => {
    expect(approvalRedirectNotice({ ...settled, draftChanged: true })).toBe(
      "Approval declined. Your message changed, so it wasn't sent.",
    );
    expect(approvalRedirectNotice({ ...settled, draftChanged: true, declined: false })).toBe(
      "Your message changed, so it wasn't sent.",
    );
  });

  it("explains an approval already being answered", () => {
    expect(
      approvalRedirectNotice({ ...settled, declined: false, approvalResponding: true }),
    ).toMatch(/already being answered/);
  });

  it("explains an approval that arrived during the decline", () => {
    expect(approvalRedirectNotice({ ...settled, approvalArrived: true })).toMatch(
      /Another approval arrived/,
    );
  });

  it("stays quiet when the decline failed or the user left the thread", () => {
    expect(approvalRedirectNotice({ ...settled, declined: false })).toBeNull();
    expect(approvalRedirectNotice(settled)).toBeNull();
  });
});

// The hook dispatches a real first-turn input; server rendering only supplies its React lifetime.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { vi } from "vite-plus/test";
import { ProviderInstanceId, ProjectId, type ModelSelection } from "@t3tools/contracts";
import { useComposerSend } from "./useComposerSend";
import { DraftId } from "../../composerDraftStore";
import type { UnifiedSettings } from "@t3tools/contracts/settings";

const sending = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("../../state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => sending.start,
}));
vi.mock("../../hooks/useHandleNewThread", () => ({ useNewThreadHandler: () => async () => null }));
vi.mock(import("../../hooks/useSettings"), async (original) => {
  const { DEFAULT_UNIFIED_SETTINGS } = await import("@t3tools/contracts/settings");
  return {
    ...(await original()),
    useClientSettingsHydrated: () => true,
    useEnvironmentSettings: <T = UnifiedSettings>(
      _environmentId: EnvironmentId,
      selector?: (settings: UnifiedSettings) => T,
    ): T => (selector ? selector(DEFAULT_UNIFIED_SETTINGS) : (DEFAULT_UNIFIED_SETTINGS as T)),
  };
});
vi.mock("../../state/peerLinks", () => ({ useLinkedEnvironments: () => [] }));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => true,
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => undefined }));
vi.mock("./useProposedPlanSend", () => ({ usePlanFollowUpSend: () => () => undefined }));
vi.mock("./useMultipleModelSend", () => ({ useMultipleModelSend: () => () => undefined }));

it.each([
  { driver: "codex", model: "native/default", options: [{ id: "reasoningEffort", value: "high" }] },
  { driver: "cursor", model: null, options: undefined },
] as const)(
  "creates and starts a new $driver thread with the same selected model",
  async ({ driver, model, options }) => {
    const instanceId = ProviderInstanceId.make(`${driver}_first_send`);
    const selection: ModelSelection = { instanceId, model, ...(options ? { options } : {}) };
    type StartCommand = {
      environmentId: EnvironmentId;
      input: {
        modelSelection: ModelSelection;
        bootstrap: { createThread: { modelSelection: ModelSelection } };
      };
    };
    let reportStarted!: (command: StartCommand) => void;
    const started = new Promise<StartCommand>((resolve) => {
      reportStarted = resolve;
    });
    let releaseAck!: () => void;
    const ack = new Promise<{ _tag: "Success"; value: undefined }>((resolve) => {
      releaseAck = () => resolve({ _tag: "Success", value: undefined });
    });
    sending.start.mockReset();
    sending.start.mockImplementation((command) => {
      reportStarted(command);
      return ack;
    });
    const threadId = ThreadId.make(`thread-${driver}-first-send`);
    const draftId = DraftId.make(`draft-${driver}-first-send`);
    const route = `route-${driver}-first-send`;
    const noop = () => undefined;
    const input = {
      environmentId: local,
      routeThreadKey: route,
      currentRouteThreadKeyRef: { current: route },
      draftId,
      activeThread: {
        id: threadId,
        environmentId: local,
        branch: null,
        worktreePath: null,
        createdAt: "2026-10-30T00:00:00.000Z",
      },
      activeProject: {
        id: ProjectId.make("project-first-send"),
        environmentId: local,
        workspaceRoot: "/synthetic",
      },
      activeThreadKey: route,
      activeThreadBranch: null,
      activeMessageCount: 0,
      isServerThread: false,
      isLocalDraftThread: true,
      isGitRepo: false,
      phase: "idle",
      runtimeMode: "full-access",
      sendEnvMode: "local",
      startFromOrigin: false,
      logicalProjectEnvironments: [],
      providerInstanceEntries: [],
      composerDraftTarget: draftId,
      promptRef: { current: "synthetic first send" },
      composerImagesRef: { current: [] },
      composerFilesRef: { current: [] },
      composerTerminalContextsRef: { current: [] },
      feedbackUploadsInFlightRef: { current: new Set() },
      queuedRunEdit: { isEditing: false },
      readPendingEnvironmentChange: () => null,
      pendingApprovals: [],
      respondingRequestIds: new Set(),
      activePendingProgress: null,
      isDraftHeroState: false,
      resumeCompactionTokens: null,
      keepFullHistory: false,
      composerRef: {
        current: {
          getSendContext: () => ({
            providerAvailable: true,
            multipleModelSelections: null,
            shownPendingApprovalIds: [],
            images: [],
            files: [],
            terminalContexts: [],
            previewAnnotations: [],
            reviewComments: [],
            threadContexts: [],
            environmentContexts: [],
            selectedProvider: driver,
            selectedModel: model ?? "",
            selectedProviderModels: [],
            selectedPromptEffort: null,
            selectedModelSelection: selection,
            interactionMode: "default",
            interactionModeEnabled: true,
          }),
          validateProviderInput: () => true,
          resetCursorState: noop,
        },
      },
      beginLocalDispatch: noop,
      resetLocalDispatch: noop,
      beginWorktreeSetup: noop,
      setSetupQueueSendThreadKey: noop,
      setDockedDraftHeroThreadKey: noop,
      setOptimisticUserMessages: noop,
      optimisticBlobPreviews: { track: noop, release: noop },
      setThreadError: noop,
      anchorNewTurn: noop,
      setKeepFullHistory: noop,
      clearUsageLimitsFor: noop,
      acknowledgeActiveThreadWoke: noop,
    } as unknown as Parameters<typeof useComposerSend>[0];
    const capture = vi.fn<(value: ReturnType<typeof useComposerSend>) => void>();
    function Harness() {
      capture(useComposerSend(input));
      return null;
    }
    renderToString(createElement(Harness));
    const submitted = capture.mock.calls[0]![0].onSend();
    try {
      const command = await Promise.race([
        started,
        submitted.then(() => {
          throw new Error("First send completed without dispatching");
        }),
      ]);
      expect(command.environmentId).toBe(local);
      expect(command.input.modelSelection).toEqual(selection);
      expect(command.input.bootstrap.createThread.modelSelection).toEqual(selection);
      expect(sending.start).toHaveBeenCalledTimes(1);
    } finally {
      releaseAck();
      await submitted;
    }
  },
);
