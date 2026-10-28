import { useEffect, useLayoutEffect } from "react";
import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../test/render";
import type { ServerLifecycleLegacyThreadMigrationPayload } from "@t3tools/contracts";

import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  notify: null as null | (() => void),
  migration: null as ServerLifecycleLegacyThreadMigrationPayload | null,
  add: vi.fn(() => "migration-qa"),
  update: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<typeof import("@effect/atom-react")>()),
  useAtomValue: () => state.migration,
}));
vi.mock("../state/server", async (original) => ({
  ...(await original<typeof import("../state/server")>()),
  primaryServerLegacyThreadMigrationAtom: {},
}));
vi.mock("./ui/toast", async (original) => ({
  ...(await original<typeof import("./ui/toast")>()),
  toastManager: state,
}));
import { changeLanguage } from "../i18n";
import { startLegacyThreadMigrationToast } from "./LegacyThreadMigrationToast";

vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: () => state.migration,
    subscribe: (_atom: unknown, notify: () => void) => {
      state.notify = notify;
      notify();
      return () => {
        state.notify = null;
      };
    },
  },
}));
function LegacyThreadMigrationToast() {
  useEffect(startLegacyThreadMigrationToast, []);
  useLayoutEffect(() => {
    state.notify?.();
  });
  return null;
}
let renderer: Screen | undefined;

it("updates the same running toast across language and count changes and closes it on completion", async () => {
  await using _lifecycle = await setupLifecycle();

  state.migration = { status: "running", totalThreadCount: 1 };
  await act(async () => {
    renderer = renderStack.use(
      await renderTestUi(null, { container: document.createElement("div"), router: false }),
    );
    await renderer.rerender(<LegacyThreadMigrationToast />);
  });
  expect(state.add).toHaveBeenCalledWith({
    type: "loading",
    title: "Restoring your threads…",
    timeout: 0,
    description:
      "Migrating 1 thread from the previous version. You can keep working while this finishes.",
  });
  await act(async () => {
    await changeLanguage("zh");
  });
  expect(state.update).toHaveBeenLastCalledWith("migration-qa", {
    type: "loading",
    title: "正在恢复会话…",
    timeout: 0,
    description: "正在迁移旧版本中的 1 个会话。迁移期间可继续使用应用。",
  });
  state.migration = { status: "running", totalThreadCount: 1234 };
  await act(async () => renderer?.rerender(<LegacyThreadMigrationToast />));
  expect(state.update).toHaveBeenLastCalledWith(
    "migration-qa",
    expect.objectContaining({
      description: "正在迁移旧版本中的 1,234 个会话。迁移期间可继续使用应用。",
    }),
  );
  await act(async () => {
    await changeLanguage("en");
  });
  expect(state.update).toHaveBeenLastCalledWith(
    "migration-qa",
    expect.objectContaining({
      description:
        "Migrating 1,234 threads from the previous version. You can keep working while this finishes.",
    }),
  );
  expect(state.add).toHaveBeenCalledOnce();
  state.migration = { status: "complete", totalThreadCount: 1234 };
  await act(async () => renderer?.rerender(<LegacyThreadMigrationToast />));
  expect(state.close).toHaveBeenCalledExactlyOnceWith("migration-qa");
  await act(async () => renderer?.unmount());
  renderer = undefined;
  expect(state.close).toHaveBeenCalledOnce();
});

it("dismisses a running notification when its client unmounts", async () => {
  await using _lifecycle = await setupLifecycle();

  state.migration = { status: "running", totalThreadCount: 0 };
  await act(async () => {
    renderer = renderStack.use(
      await renderTestUi(null, { container: document.createElement("div"), router: false }),
    );
    await renderer.rerender(<LegacyThreadMigrationToast />);
  });
  expect(state.add).toHaveBeenCalledWith(
    expect.objectContaining({
      description:
        "Migrating 0 threads from the previous version. You can keep working while this finishes.",
    }),
  );
  await act(async () => renderer?.unmount());
  renderer = undefined;
  expect(state.close).toHaveBeenCalledExactlyOnceWith("migration-qa");
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
    await changeLanguage("en");
  });

  vi.clearAllMocks();

  await changeLanguage("en");
  state.migration = null;

  renderStack = stack.move();
  return renderStack;
}
