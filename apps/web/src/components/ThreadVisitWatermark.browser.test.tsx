import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../../test/render";

const state = vi.hoisted(() => ({
  focused: false,
  visible: "visible",
  threads: new Map<string, Record<string, unknown>>(),
  visit: vi.fn(),
  markLocal: vi.fn(),
}));
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useThreadShell: ((ref: ScopedThreadRef) =>
    state.threads.get(`${ref.environmentId}:${ref.threadId}`)) as never,
}));
vi.mock(import("../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.visit) as never,
}));
vi.mock(import("../uiStateStore"), async (original) => ({
  ...(await original()),
  useUiStateStore: ((select: (store: unknown) => unknown) =>
    select({
      markThreadVisited: state.markLocal,
      threadLastVisitedAtById: {},
    })) as never,
}));

import { ThreadVisitWatermark } from "./ThreadVisitWatermark";

const START = "2026-10-21T09:00:00.000Z";
const END = "2026-10-21T09:04:00.000Z";
function ref(environment = "one") {
  return scopeThreadRef(EnvironmentId.make(environment), ThreadId.make("thread"));
}
function shell(environment = "one", completed = false) {
  return {
    environmentId: EnvironmentId.make(environment),
    id: ThreadId.make("thread"),
    updatedAt: completed ? END : START,
    lastVisitedAt: "2026-10-21T08:00:00.000Z",
    latestRun: { status: completed ? "completed" : "running", completedAt: completed ? END : null },
  };
}
function setup() {
  vi.clearAllMocks();
  state.focused = false;
  state.visible = "visible";
  state.threads = new Map([["one:thread", shell()]]);
  const stack = new DisposableStack();
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
    await using screen = await render(<ThreadVisitWatermark threadRef={ref()} />);
    expect(state.visit).not.toHaveBeenCalled();
    state.threads.set("one:thread", shell("one", true));
    await screen.rerender(<ThreadVisitWatermark threadRef={ref()} />);
    expect(state.visit).not.toHaveBeenCalled();
    await focus(true);
    expect(state.visit).toHaveBeenCalledExactlyOnceWith({
      environmentId: "one",
      input: { threadId: "thread", visitedAt: END },
    });
  },
);

it("reads only the routed environment and preserves a manual unread rewind across focus", async () => {
  using _setup = setup();
  state.threads.set("one:thread", shell("one", true));
  state.threads.set("two:thread", shell("two", true));
  await using screen = await render(<ThreadVisitWatermark threadRef={ref()} />);
  await focus(true);
  expect(state.visit).toHaveBeenCalledTimes(1);
  expect(state.visit.mock.calls[0]?.[0].environmentId).toBe("one");
  state.threads.set("one:thread", { ...shell("one", true), lastVisitedAt: START });
  await screen.rerender(<ThreadVisitWatermark threadRef={ref()} />);
  await focus(false);
  await focus(true);
  expect(state.visit).toHaveBeenCalledTimes(1);
  await screen.rerender(<ThreadVisitWatermark threadRef={ref("two")} />);
  expect(state.visit).toHaveBeenCalledTimes(2);
  expect(state.visit.mock.calls[1]?.[0].environmentId).toBe("two");
});

it.each(["blur", "hidden"])("does not write a throttled visit after %s", async (condition) => {
  using _setup = setup();
  state.focused = true;
  await using screen = await render(<ThreadVisitWatermark threadRef={ref()} />);
  expect(state.visit).toHaveBeenCalledTimes(1);
  using _timers = fakeTimers();
  state.threads.set("one:thread", { ...shell(), updatedAt: "2026-10-21T09:00:01.000Z" });
  await screen.rerender(<ThreadVisitWatermark threadRef={ref()} />);
  expect(state.visit).toHaveBeenCalledTimes(1);
  await focus(condition === "hidden", condition === "hidden" ? "hidden" : "visible");
  await act(() => vi.advanceTimersByTime(10_000));
  expect(state.visit).toHaveBeenCalledTimes(1);
  await focus(true);
  expect(state.visit).toHaveBeenCalledTimes(2);
  expect(state.visit.mock.calls[1]?.[0].input.visitedAt).toBe("2026-10-21T09:00:01.000Z");
});
