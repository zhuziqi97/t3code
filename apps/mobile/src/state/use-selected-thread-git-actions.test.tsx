import { act, useEffect, useReducer } from "react";
import { RegistryContext } from "@effect/atom-react";
import { createRoot, type Root } from "react-dom/client";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  selection: {
    selectedThread: { environmentId: "environment-1", id: "thread-1" } as unknown,
    selectedThreadProject: { workspaceRoot: "/repo" } as unknown,
    selectedEnvironmentRuntime: { connectionState: "connected" } as unknown,
  },
  worktree: { selectedThreadCwd: "/repo" as string | null, selectedThreadWorktreePath: null },
  refreshStatusCalls: [] as Array<unknown>,
  refreshStatus: { label: "refreshStatus", run: vi.fn() },
  renderCount: 0,
  onRefreshSettled: () => {},
}));

vi.mock("./use-atom-command", () => ({
  useAtomCommand: (command: unknown) =>
    command === harness.refreshStatus
      ? (input: unknown) => harness.refreshStatus.run(registry, input)
      : async () => AsyncResult.success({}),
}));
vi.mock("./vcs", () => ({
  vcsEnvironment: { refreshStatus: harness.refreshStatus },
  vcsActionManager: { runStackedAction: () => "runStackedAction", track: vi.fn() },
}));
vi.mock("./workspaceRecovery", () => ({
  workspaceRecoveryEnvironment: { recover: "recoverWorkspace" },
}));
vi.mock("./threads", () => ({ threadEnvironment: { updateMetadata: "updateMetadata" } }));
vi.mock("./queries", () => ({ useBranches: () => ({ data: null, refresh: () => {} }) }));
vi.mock("../lib/uuid", () => ({ uuidv4: () => "uuid" }));
vi.mock("./atom-registry", () => ({
  get appAtomRegistry() {
    return registry;
  },
}));
vi.mock("./session", () => ({
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock("./use-remote-environment-registry", () => ({
  environmentConnectedAtom: (environmentId: string) => connectedAtom(environmentId),
  setPendingConnectionError: () => harness.onRefreshSettled(),
}));
vi.mock("./use-vcs-action-state", () => ({ showGitActionResult: () => {} }));
vi.mock("./use-thread-selection", () => ({
  useThreadSelection: () => {
    harness.renderCount += 1;
    if (harness.renderCount > 50) {
      throw new Error("Consumer rerendered more than 50 times");
    }
    return harness.selection;
  },
}));
vi.mock("./use-selected-thread-worktree", () => ({
  useSelectedThreadWorktree: () => harness.worktree,
}));

import { useSelectedThreadGitActions } from "./use-selected-thread-git-actions";

let root: Root | null = null;
let registry: AtomRegistry.AtomRegistry;
const connectedAtom = Atom.family((_environmentId: string) =>
  Atom.make(false).pipe(Atom.keepAlive),
);
let rerender: () => void = () => {};

function Consumer() {
  const [, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    rerender = bump;
  });
  useSelectedThreadGitActions();
  return null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.selection = {
    selectedThread: { environmentId: "environment-1", id: "thread-1" },
    selectedThreadProject: { workspaceRoot: "/repo" },
    selectedEnvironmentRuntime: { connectionState: "connected" },
  };
  harness.worktree = { selectedThreadCwd: "/repo", selectedThreadWorktreePath: null };
  harness.refreshStatusCalls = [];
  harness.refreshStatus.run.mockImplementation(async (_registry: unknown, input: unknown) => {
    harness.refreshStatusCalls.push(input);
    return AsyncResult.success({});
  });
  registry = AtomRegistry.make();
  registry.set(connectedAtom("environment-1"), true);
  harness.renderCount = 0;
  harness.onRefreshSettled = () => rerender();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  registry.dispose();
});

describe("useSelectedThreadGitActions", () => {
  it("refreshes once on mount and does not loop when refreshes rerender the consumer", async () => {
    let finishRefresh = () => {};
    const refreshed = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    harness.onRefreshSettled = () => {
      rerender();
      finishRefresh();
    };
    root = createRoot(document.createElement("div"));
    act(() =>
      root!.render(
        <RegistryContext.Provider value={registry}>
          <Consumer />
        </RegistryContext.Provider>,
      ),
    );
    await act(async () => refreshed);

    harness.selection = {
      selectedThread: { environmentId: "environment-1", id: "thread-1" },
      selectedThreadProject: { workspaceRoot: "/repo" },
      selectedEnvironmentRuntime: { connectionState: "connected" },
    };
    await act(async () => rerender());

    expect(harness.refreshStatusCalls).toEqual([
      { environmentId: "environment-1", input: { cwd: "/repo" } },
    ]);
  });
});
