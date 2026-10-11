import type { ServerLifecycleLegacyThreadMigrationPayload } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  migration: null as ServerLifecycleLegacyThreadMigrationPayload | null,
  add: vi.fn(() => "migration-qa"),
  update: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.migration }));
vi.mock("../state/server", () => ({ primaryServerLegacyThreadMigrationAtom: {} }));
vi.mock("./ui/toast", () => ({ toastManager: state }));
import { changeLanguage } from "../i18n";
import { LegacyThreadMigrationToast } from "./LegacyThreadMigrationToast";

let renderer: ReactTestRenderer | undefined;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLanguage("en");
  state.migration = null;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  await changeLanguage("en");
});

it("updates the same running toast across language and count changes and closes it on completion", async () => {
  state.migration = { status: "running", totalThreadCount: 1 };
  await act(async () => {
    renderer = create(<LegacyThreadMigrationToast />);
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
  await act(async () => renderer?.update(<LegacyThreadMigrationToast />));
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
  await act(async () => renderer?.update(<LegacyThreadMigrationToast />));
  expect(state.close).toHaveBeenCalledExactlyOnceWith("migration-qa");
  await act(async () => renderer?.unmount());
  renderer = undefined;
  expect(state.close).toHaveBeenCalledOnce();
});

it("dismisses a running notification when its client unmounts", async () => {
  state.migration = { status: "running", totalThreadCount: 0 };
  await act(async () => {
    renderer = create(<LegacyThreadMigrationToast />);
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
