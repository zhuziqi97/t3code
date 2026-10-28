import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../test/render";
import { createElement, useLayoutEffect } from "react";

import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  ThreadId,
  type ContextMenuItem,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import type { ThreadActionMenuId } from "../components/threadActionMenu.logic";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const state = vi.hoisted(() => ({
  granted: new Set<string>(),
  effects: [] as string[],
  completed: deferred<void>(),
  show: vi.fn<
    (
      items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>>,
      position: { x: number; y: number },
    ) => Promise<ThreadActionMenuId | null>
  >(),
}));

function recordEffect(action: string) {
  state.effects.push(action);
  state.completed.resolve();
}

vi.mock("../components/CustomSnoozeDialog", async (original) => ({
  ...(await original<typeof import("../components/CustomSnoozeDialog")>()),
  requestCustomSnooze: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({ navigate: async () => recordEffect("project-settings") }),
}));
vi.mock("../state/session", async (original) => ({
  ...(await original<typeof import("../state/session")>()),
  readEnvironmentScope: (environmentId: string, scope: string) =>
    scope === AuthOrchestrationOperateScope && state.granted.has(environmentId),
}));
vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  readEnvironmentSupportsAutoSettleOptOut: () => true,
  readEnvironmentSupportsPinning: () => true,
  readEnvironmentSupportsSettlement: () => true,
  readEnvironmentSupportsSnooze: () => true,
  readEnvironmentSupportsTitleRegeneration: () => true,
  readThreadShell: () => ({
    id: "thread",
    environmentId: "secondary",
    projectId: "project",
    title: "Thread",
    branch: "main",
    worktreePath: null,
    runtime: null,
    latestRun: null,
  }),
  useProjects: () => [{ id: "project", environmentId: "secondary" }],
}));
vi.mock("../state/environments", async (original) => ({
  ...(await original<typeof import("../state/environments")>()),
  usePrimaryEnvironmentId: () => "primary",
}));
vi.mock("../state/threads", async (original) => ({
  ...(await original<typeof import("../state/threads")>()),
  threadEnvironment: { updateMetadata: "metadata" },
}));
vi.mock("../state/use-atom-command", async (original) => ({
  ...(await original<typeof import("../state/use-atom-command")>()),
  useAtomCommand: () => async () => {
    recordEffect("metadata");
    return AsyncResult.success(undefined);
  },
}));
vi.mock("../localApi", async (original) => ({
  ...(await original<typeof import("../localApi")>()),
  readLocalApi: () => ({
    contextMenu: { show: state.show, close: () => {} },
    dialogs: {
      confirm: async () => {
        recordEffect("confirm");
        return false;
      },
    },
  }),
}));
vi.mock("../logicalProject", async (original) => ({
  ...(await original<typeof import("../logicalProject")>()),
  deriveLogicalProjectKeyFromSettings: () => "project",
  derivePhysicalProjectKey: () => "project",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../sidebarProjectGrouping", async (original) => ({
  ...(await original<typeof import("../sidebarProjectGrouping")>()),
  buildPhysicalToLogicalProjectKeyMap: () => new Map(),
}));
vi.mock("../uiStateStore", async (original) => ({
  ...(await original<typeof import("../uiStateStore")>()),
  useUiStateStore: (select: (store: unknown) => unknown) =>
    select({
      markThreadUnread: () => recordEffect("mark-unread"),
    }),
}));
vi.mock("../components/ui/toast", async (original) => ({
  ...(await original<typeof import("../components/ui/toast")>()),
  stackedThreadToast: (toast: unknown) => toast,
  toastManager: { add: () => state.completed.resolve() },
}));
vi.mock("../components/Sidebar.snooze", async (original) => ({
  ...(await original<typeof import("../components/Sidebar.snooze")>()),
  resolveSnoozePresets: () => [
    { id: "hour", label: "In 1 hour", whenLabel: "3 PM", snoozedUntil: "2099-01-01T00:00:00Z" },
  ],
  snoozeWakeDescription: () => "later",
}));
vi.mock("./useCopyToClipboard", async (original) => ({
  ...(await original<typeof import("./useCopyToClipboard")>()),
  useCopyToClipboard: () => ({ copyToClipboard: () => recordEffect("copy") }),
}));
vi.mock("./useHandleNewThread", async (original) => ({
  ...(await original<typeof import("./useHandleNewThread")>()),
  useNewThreadHandler: () => async () => recordEffect("draft"),
}));
vi.mock("./useSettings", async (original) => ({
  ...(await original<typeof import("./useSettings")>()),
  useClientSettings: (select: (settings: unknown) => unknown) =>
    select({
      confirmThreadDelete: true,
      confirmThreadArchive: true,
      timestampFormat: "12-hour",
    }),
}));
vi.mock("./useThreadActions", async (original) => ({
  ...(await original<typeof import("./useThreadActions")>()),
  useThreadActions: () =>
    Object.fromEntries(
      [
        "markThreadUnread",
        "settleThread",
        "unsettleThread",
        "snoozeThread",
        "unsnoozeThread",
        "pinThread",
        "confirmAndUnpinThread",
        "archiveThread",
        "deleteThread",
      ].map((action) => [
        action,
        async () => {
          recordEffect(action === "markThreadUnread" ? "mark-unread" : action);
          return AsyncResult.success(undefined);
        },
      ]),
    ),
}));

import { useThreadActionMenu } from "./useThreadActionMenu";

const target = {
  environmentId: EnvironmentId.make("secondary"),
  threadId: ThreadId.make("thread"),
};
const position = { x: 10, y: 20 };

const hookRenderers: Screen[] = [];
async function createMenu() {
  let result!: ReturnType<typeof useThreadActionMenu>;
  function Harness() {
    const actions = useThreadActionMenu({
      canShareWithGuest: false,
      threadRef: target,
      projectCwd: "/project",
      onStartRename: () => recordEffect("rename"),
    });
    useLayoutEffect(() => {
      result = actions;
    });
    return null;
  }
  await act(async () => {
    const root = renderStack.use(
      await renderTestUi(null, { container: document.createElement("div"), router: false }),
    );
    hookRenderers.push(root);
    await root.rerender(createElement(Harness));
  });
  return result;
}

describe("thread menu permissions", () => {
  it("disables mutations for a denied secondary environment", async () => {
    await using _lifecycle = await setupLifecycle();

    (await createMenu()).openMenu(position);
    const items = state.show.mock.calls[0]![0];
    expect(items.find((item) => item.id === "rename")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "delete")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "copy")?.disabled).not.toBe(true);
  });

  it("allows the target grant even when the primary environment is denied", async () => {
    await using _lifecycle = await setupLifecycle();

    state.granted = new Set(["secondary"]);
    (await createMenu()).openMenu(position);
    expect(state.show.mock.calls[0]![0].find((item) => item.id === "rename")?.disabled).not.toBe(
      true,
    );
  });

  it("refreshes availability when a retained menu opener gains permission", async () => {
    await using _lifecycle = await setupLifecycle();

    const menu = await createMenu();
    menu.openMenu(position);
    expect(state.show.mock.calls[0]![0].find((item) => item.id === "rename")?.disabled).toBe(true);
    state.granted.add("secondary");
    menu.openMenu(position);
    expect(state.show.mock.calls[1]![0].find((item) => item.id === "rename")?.disabled).not.toBe(
      true,
    );
  });

  it.each(["rename", "regenerate-title", "delete", "pin", "settle", "archive"] as const)(
    "%s rechecks after the native menu closes",
    async (action) => {
      await using _lifecycle = await setupLifecycle();

      state.granted.add("secondary");
      const choice = deferred<ThreadActionMenuId | null>();
      state.show.mockReturnValue(choice.promise);
      (await createMenu()).openMenu(position);
      state.granted.delete("secondary");
      choice.resolve(action);
      await state.completed.promise;
      expect(state.effects).toEqual([]);
    },
  );

  it.each([
    ["new-thread-on-branch", "draft"],
    ["copy-thread-id", "copy"],
    ["mark-unread", "mark-unread"],
    ["project-settings", "project-settings"],
  ] as const)("keeps %s available without task permission", async (action, effect) => {
    await using _lifecycle = await setupLifecycle();

    state.show.mockResolvedValue(action);
    (await createMenu()).openMenu(position);
    await state.completed.promise;
    expect(state.effects).toEqual([effect]);
  });
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(() => hookRenderers.splice(0).forEach((renderer) => renderer.unmount()));
    vi.unstubAllGlobals();
  });

  state.granted = new Set(["primary"]);
  state.effects = [];
  state.completed = deferred<void>();
  state.show.mockReset().mockResolvedValue(null);

  renderStack = stack.move();
  return renderStack;
}
