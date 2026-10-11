// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ named: false, providers: vi.fn(() => null) }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useSearch: () => ({}) }),
}));
vi.mock("../components/settings/ProviderSettingsPanel", () => ({
  ProviderSettingsPanel: state.providers,
}));
vi.mock("../components/settings/SettingsScopeContext", () => ({
  useSettingsScope: () => ({
    environment: null,
    scope: state.named ? { kind: "environment", label: "开发电脑 / Raw laptop" } : { kind: "all" },
  }),
}));

import { changeLanguage } from "../i18n";
import { Route } from "./settings.providers";

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.providers.mockClear();
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.unstubAllGlobals();
});

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
    state.named = named;
    const ProvidersRoute = Route.options.component!;
    await act(() => root.render(<ProvidersRoute />));
    expect(container.textContent).toBe(english);
    await act(() => changeLanguage("zh"));
    expect(container.textContent).toBe(chinese);
    await act(() => changeLanguage("en"));
    expect(container.textContent).toBe(english);
    expect(state.providers).not.toHaveBeenCalled();
  },
);
