import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../test/render";

import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ named: false, providers: vi.fn(() => null) }));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: unknown) => ({ options, useSearch: () => ({}) }),
}));
vi.mock("../components/settings/ProviderSettingsPanel", async (original) => ({
  ...(await original<typeof import("../components/settings/ProviderSettingsPanel")>()),
  ProviderSettingsPanel: state.providers,
}));
vi.mock("../components/settings/SettingsScopeContext", async (original) => ({
  ...(await original<typeof import("../components/settings/SettingsScopeContext")>()),
  useSettingsScope: () => ({
    environment: null,
    scope: state.named ? { kind: "environment", label: "开发电脑 / Raw laptop" } : { kind: "all" },
  }),
}));

import { changeLanguage } from "../i18n";
import { Route } from "./settings.providers";

let root: Screen;
let container: HTMLDivElement;

it.each([
  [
    false,
    "Connect an environment to set up its providers.",
    "请连接执行环境，以配置其智能体提供方。",
  ],
  [
    true,
    "Reconnect 开发电脑 / Raw laptop to set up its providers.",
    "请重新连接 开发电脑 / Raw laptop，以配置其智能体提供方。",
  ],
])(
  "updates an unavailable provider page when the language changes: named=%s",
  async (named, english, chinese) => {
    await using _lifecycle = await setupLifecycle();

    state.named = named;
    const ProvidersRoute = Route.options.component!;
    await act(() => root.rerender(<ProvidersRoute />));
    await expect.element(root.getByText(english, { exact: true })).toBeVisible();
    await act(() => changeLanguage("zh"));
    await expect.element(root.getByText(chinese, { exact: true })).toBeVisible();
    await act(() => changeLanguage("en"));
    await expect.element(root.getByText(english, { exact: true })).toBeVisible();
    expect(state.providers).not.toHaveBeenCalled();
  },
);

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(() => root.unmount());
    container.remove();
    await changeLanguage("en");
    vi.unstubAllGlobals();
  });

  state.providers.mockClear();
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));

  renderStack = stack.move();
  return renderStack;
}
