// @vitest-environment jsdom
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ settings: null as UnifiedSettings | null, update: vi.fn() }));
vi.mock("./useScopedSettings", () => ({
  useScopedSettings: (selector?: (settings: UnifiedSettings) => unknown) =>
    selector ? selector(state.settings!) : state.settings,
  useUpdateScopedSettings: () => state.update,
  useScopedSettingsMixed: () => false,
  useScopedSettingSource: () => "environment",
  useScopedSettingsWriteAllowed: () => true,
  useClearScopedSettings: () => vi.fn(),
  useClearProjectOverrides: () => vi.fn(),
}));
vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => ({
    scope: { kind: "all", environmentIds: [] },
    environment: null,
    connectedEnvironments: [],
    targets: [],
    target: null,
    groups: [],
    search: {},
    selectScope: vi.fn(),
  }),
  useOptionalSettingsScope: () => null,
}));
vi.mock("../../state/environments", async (original) => ({
  ...(await original<typeof import("../../state/environments")>()),
  useEnvironments: () => ({ environments: [] }),
  usePrimaryEnvironment: () => null,
  usePrimaryEnvironmentId: () => null,
}));
vi.mock("../../state/session", async (original) => ({
  ...(await original<typeof import("../../state/session")>()),
  useEnvironmentScope: () => true,
  useEnvironmentsWithScope: () => new Set(),
}));
vi.mock("../../hooks/useSettings", async (original) => ({
  ...(await original<typeof import("../../hooks/useSettings")>()),
  usePrimarySettingsAvailable: () => true,
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useLocation: ({ select }: { select: (location: unknown) => unknown }) =>
    select({ pathname: "/settings/general", hash: "", state: {}, search: {} }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

import { GeneralSettingsPanel } from "./SettingsPanels";
import { changeLanguage } from "../../i18n";
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  state.settings = { ...DEFAULT_UNIFIED_SETTINGS, languagePreference: "zh" };
  state.update.mockClear();
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.unstubAllGlobals();
});

it("updates the actual General rows in both directions without remounting", async () => {
  await act(async () => root.render(<GeneralSettingsPanel />));
  expect(container.querySelector("#send-shortcut h3")?.textContent).toBe("Send shortcut");
  await act(async () => {
    await changeLanguage("zh");
  });
  expect(container.querySelector("#send-shortcut h3")?.textContent).toBe("发送快捷键");
  expect(container.querySelector("#worktree-submodules h3")?.textContent).toBe("子模块");
  await act(async () => {
    await changeLanguage("en");
  });
  expect(container.querySelector("#send-shortcut h3")?.textContent).toBe("Send shortcut");
  expect(container.querySelector("#worktree-submodules h3")?.textContent).toBe("Submodules");
  const reset = container.querySelector<HTMLButtonElement>(
    '[aria-label="Reset Language to default"]',
  )!;
  expect(reset).not.toBeNull();
  await act(async () => reset.click());
  expect(state.update).toHaveBeenCalledWith({ languagePreference: "system" });
});
