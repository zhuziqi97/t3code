import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../../test/render";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts";

import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({ settings: null as UnifiedSettings | null, update: vi.fn() }));
vi.mock("./useScopedSettings", async (original) => ({
  ...(await original<typeof import("./useScopedSettings")>()),
  useScopedSettings: (selector?: (settings: UnifiedSettings) => unknown) =>
    selector ? selector(state.settings!) : state.settings,
  useUpdateScopedSettings: () => state.update,
  useScopedSettingsMixed: () => false,
  useScopedSettingSource: () => "environment",
  useScopedSettingsWriteAllowed: () => true,
  useClearScopedSettings: () => vi.fn(),
  useClearProjectOverrides: () => vi.fn(),
}));
vi.mock("./SettingsScopeContext", async (original) => ({
  ...(await original<typeof import("./SettingsScopeContext")>()),
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
import { SnoozePresetsRow } from "./SnoozePresetsSettings";
import { changeLanguage } from "../../i18n";
let root: Screen;
let container: HTMLDivElement;

it("updates the actual General rows in both directions without remounting", async () => {
  await using _lifecycle = await setupLifecycle();

  await act(async () => root.rerender(<GeneralSettingsPanel />));
  expect(container.querySelector("#project-grouping h3")?.textContent).toBe("Project grouping");
  const timeFormat = container.querySelector('[aria-label="Time format"]');
  expect(timeFormat?.textContent).toBe("System default");
  await act(async () => {
    await changeLanguage("zh");
  });
  expect(container.querySelector("#project-grouping h3")?.textContent).toBe("项目分组");
  expect(container.querySelector("#time-format h3")?.textContent).toBe("时间格式");
  expect(container.querySelector('[aria-label="时间格式"]')).toBe(timeFormat);
  expect(timeFormat?.textContent).toBe("跟随系统");
  expect(state.settings?.timestampFormat).toBe("locale");
  expect(state.update).not.toHaveBeenCalled();
  await act(async () => {
    await changeLanguage("en");
  });
  expect(container.querySelector("#project-grouping h3")?.textContent).toBe("Project grouping");
  expect(container.querySelector("#time-format h3")?.textContent).toBe("Time format");
  const reset = container.querySelector<HTMLButtonElement>(
    '[aria-label="Reset Language to default"]',
  )!;
  expect(reset).not.toBeNull();
  await act(async () => reset.click());
  expect(state.update).toHaveBeenCalledWith({ languagePreference: "system" });
});

it("keeps an uncommitted snooze amount and field focus while changing language", async () => {
  state.settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    snoozePresets: [{ kind: "after", minutes: 60 }],
  };
  state.update.mockReset();
  await changeLanguage("en");
  await using language = new AsyncDisposableStack();
  language.defer(() => changeLanguage("en").then(() => {}));
  await using screen = await renderTestUi(<SnoozePresetsRow />);
  const amount = screen.getByRole("spinbutton", { name: "Amount" });
  await userEvent.fill(amount, "12");
  const input = amount.element();
  await act(() => changeLanguage("zh"));
  const translated = screen.getByRole("spinbutton", { name: "时长数值" });
  expect(translated.element()).toBe(input);
  await expect.element(translated).toHaveFocus();
  await expect.element(translated).toHaveValue("12");
  expect(state.update).not.toHaveBeenCalled();
  await userEvent.keyboard("{Enter}");
  expect(state.update).toHaveBeenCalledExactlyOnceWith(
    { snoozePresets: [{ kind: "after", minutes: 720 }] },
    { onFailed: expect.any(Function) },
  );
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    await changeLanguage("en");
    vi.unstubAllGlobals();
  });

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
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));

  renderStack = stack.move();
  return renderStack;
}
