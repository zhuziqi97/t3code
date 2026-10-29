import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { RegistryContext } from "@effect/atom-react";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../../test/render";

const state = vi.hoisted(() => ({
  focused: false,
  visible: "visible",
  threadId: "thread",
  registry: null as unknown as AtomRegistry.AtomRegistry,
  visit: vi.fn(),
}));

vi.mock(import("../state/threads"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    environmentThreadShells: {
      ...actual.environmentThreadShells,
      threadShellAtom: ((ref: ScopedThreadRef) =>
        shellAtom(`${ref.environmentId}:${ref.threadId}`)) as never,
    },
    threadEnvironment: {
      ...actual.threadEnvironment,
      visit: {
        label: "visit",
        run: (_registry: unknown, input: unknown) => state.visit(input),
      } as never,
    },
  };
});

import { ThreadVisitWatermark } from "./ThreadVisitWatermark";

const START = "2026-10-21T09:00:00.000Z";
const END = "2026-10-21T09:04:00.000Z";
const shellAtom = Atom.family((_key: string) =>
  Atom.make<ReturnType<typeof shell> | null>(null).pipe(Atom.keepAlive),
);
function setShell(environment: string, value: ReturnType<typeof shell>) {
  state.registry.set(shellAtom(`${environment}:${state.threadId}`), value);
}
function watermark(threadRef: ScopedThreadRef) {
  return (
    <RegistryContext.Provider value={state.registry}>
      <ThreadVisitWatermark threadRef={threadRef} />
    </RegistryContext.Provider>
  );
}
function ref(environment = "one") {
  return scopeThreadRef(EnvironmentId.make(environment), ThreadId.make(state.threadId));
}
function shell(environment = "one", completed = false) {
  return {
    environmentId: EnvironmentId.make(environment),
    id: ThreadId.make(state.threadId),
    updatedAt: completed ? END : START,
    lastVisitedAt: "2026-10-21T08:00:00.000Z",
    latestRun: { status: completed ? "completed" : "running", completedAt: completed ? END : null },
  };
}
function setup() {
  vi.clearAllMocks();
  state.focused = false;
  state.visible = "visible";
  state.threadId = expect.getState().currentTestName ?? "thread";
  state.registry = AtomRegistry.make();
  state.visit.mockResolvedValue(AsyncResult.success(undefined));
  setShell("one", shell());
  const stack = new DisposableStack();
  stack.defer(() => state.registry.dispose());
  stack.use(vi.spyOn(document, "hasFocus").mockImplementation(() => state.focused));
  stack.use(
    vi
      .spyOn(document, "visibilityState", "get")
      .mockImplementation(() => state.visible as DocumentVisibilityState),
  );
  return stack;
}
async function focus(focused: boolean, visible = "visible") {
  state.focused = focused;
  state.visible = visible;
  await act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event(focused ? "focus" : "blur"));
  });
}

it.each(["visible", "hidden"])(
  "keeps a completion unread while %s and unfocused, then reads the current thread on focus",
  async (visible) => {
    using _setup = setup();
    state.visible = visible;
    await using screen = await render(watermark(ref()));
    expect(state.visit).not.toHaveBeenCalled();
    setShell("one", shell("one", true));
    await screen.rerender(watermark(ref()));
    expect(state.visit).not.toHaveBeenCalled();
    await focus(true);
    expect(state.visit).toHaveBeenCalledExactlyOnceWith({
      environmentId: "one",
      input: { threadId: state.threadId, visitedAt: END, opened: true },
    });
  },
);

it("reads only the routed environment and preserves a manual unread rewind across focus", async () => {
  using _setup = setup();
  setShell("one", shell("one", true));
  setShell("two", shell("two", true));
  await using screen = await render(watermark(ref()));
  await focus(true);
  expect(state.visit).toHaveBeenCalledTimes(1);
  expect(state.visit.mock.calls[0]?.[0].environmentId).toBe("one");
  expect(state.visit.mock.calls[0]?.[0].input.threadId).toBe(state.threadId);
  setShell("one", { ...shell("one", true), lastVisitedAt: START });
  await screen.rerender(watermark(ref()));
  await focus(false);
  await focus(true);
  expect(state.visit).toHaveBeenCalledTimes(1);
  await screen.rerender(watermark(ref("two")));
  expect(state.visit).toHaveBeenCalledTimes(2);
  expect(state.visit.mock.calls[1]?.[0].environmentId).toBe("two");
});

it.each(["blur", "hidden"])("does not write a throttled visit after %s", async (condition) => {
  using _setup = setup();
  state.focused = true;
  await using screen = await render(watermark(ref()));
  expect(state.visit).toHaveBeenCalledTimes(1);
  using _timers = fakeTimers();
  setShell("one", { ...shell(), updatedAt: "2026-10-21T09:00:01.000Z" });
  await screen.rerender(watermark(ref()));
  expect(state.visit).toHaveBeenCalledTimes(1);
  await focus(condition === "hidden", condition === "hidden" ? "hidden" : "visible");
  await act(() => vi.advanceTimersByTime(10_000));
  expect(state.visit).toHaveBeenCalledTimes(1);
  await focus(true);
  expect(state.visit).toHaveBeenCalledTimes(2);
  expect(state.visit.mock.calls[1]?.[0].input.visitedAt).toBe("2026-10-21T09:00:01.000Z");
});
