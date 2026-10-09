// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";

const state = vi.hoisted(() => ({
  upsert: vi.fn(),
  remove: vi.fn(),
  open: vi.fn(),
  toast: vi.fn(),
  denied: new Set<string>(),
}));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => "" }));
vi.mock("../../state/server", () => ({
  serverEnvironment: { upsertKeybinding: state.upsert, removeKeybinding: state.remove },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("../../editorPreferences", () => ({ useOpenInPreferredEditor: () => state.open }));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => true,
  useEnvironmentsWithScope: () =>
    new Set(["primary", "second"].filter((id) => !state.denied.has(id))),
  readEnvironmentScope: (id: string) => !state.denied.has(id),
}));
vi.mock("./SettingsScopeContext", () => {
  const environment = {
    environmentId: "primary",
    serverConfig: {
      keybindings: [],
      keybindingsConfigPath: "/original/keybindings.json",
      availableEditors: ["vscode"],
    },
  };
  return {
    useSettingsScope: () => ({
      environment,
      connectedEnvironments: [environment, { environmentId: "second" }],
    }),
  };
});
vi.mock("./settingsLayout", () => ({
  SettingsRow: ({
    title,
    description,
    control,
    id,
  }: {
    title: ReactNode;
    description: ReactNode;
    control: ReactNode;
    id: string;
  }) => (
    <section id={id}>
      {title}
      {description}
      {control}
    </section>
  ),
  SettingsSection: ({
    title,
    children,
    headerAction,
  }: {
    title: ReactNode;
    children: ReactNode;
    headerAction: ReactNode;
  }) => (
    <section>
      {title}
      {headerAction}
      {children}
    </section>
  ),
  SettingsPageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: state.toast } }));

import { changeLanguage } from "../../i18n";
import { KeybindingsSettingsPanel } from "./KeybindingsSettings";

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLanguage("en");
  state.denied.clear();
  state.upsert.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.remove.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.open.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.toast.mockReset();
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
const render = async () => act(async () => root.render(<KeybindingsSettingsPanel />));
const language = async (lang: "zh" | "en") => act(async () => changeLanguage(lang));
function button(label: string) {
  const target = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.getAttribute("aria-label") === label || node.textContent?.trim() === label,
  );
  expect(target, label).toBeDefined();
  return target!;
}
const click = async (label: string) => act(async () => button(label).click());
const type = async (input: HTMLInputElement, value: string) =>
  act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
function search() {
  return container.querySelector<HTMLInputElement>('input[type="search"]')!;
}
function capture() {
  return container.querySelector<HTMLInputElement>("input[data-keybinding-capture]")!;
}
const key = async (input: HTMLInputElement, options: KeyboardEventInit) =>
  act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...options }),
    );
  });
async function editSidebar() {
  await type(search(), "sidebar.toggle");
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label^="Edit shortcut for Sidebar"]',
  )!;
  await act(async () => trigger.click());
  await act(async () => capture().focus());
}

it("keeps recording and draft identity across locale changes, then saves native keys to both environments once", async () => {
  let resolve!: (result: unknown) => void;
  state.upsert.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
  await render();
  await editSidebar();
  const input = capture();
  await language("zh");
  expect(capture()).toBe(input);
  expect(input.placeholder).toBe("请按下快捷键");
  expect(search().value).toBe("sidebar.toggle");
  expect(state.upsert).not.toHaveBeenCalled();
  await key(input, { key: "K", code: "KeyK", ctrlKey: true, shiftKey: true });
  expect(input.value).toBe("mod+shift+k");
  await click("保存");
  expect(state.upsert).toHaveBeenCalledTimes(2);
  for (const environmentId of ["primary", "second"]) {
    expect(state.upsert).toHaveBeenCalledWith({
      environmentId,
      input: {
        command: "sidebar.toggle",
        key: "mod+shift+k",
        replace: { command: "sidebar.toggle", key: "mod+b" },
      },
    });
  }
  await language("en");
  expect(capture()).toBe(input);
  expect(input.value).toBe("mod+shift+k");
  expect(button("Saving").disabled).toBe(true);
  expect(state.upsert).toHaveBeenCalledTimes(2);
  await act(async () => resolve(AsyncResult.success(undefined)));
  expect(button("Save").disabled).toBe(false);
});

it("retains an invalid condition draft, retranslates its error, and submits a corrected native expression", async () => {
  await render();
  await type(search(), "sidebar.toggle");
  await click("Edit when clause for Sidebar: Toggle");
  const input = document.querySelector<HTMLInputElement>('input[aria-label="When expression"]')!;
  await type(input, "terminalFocus");
  await type(input, "terminalFocus &&");
  expect(button("Save").disabled).toBe(true);
  await language("zh");
  expect(document.querySelector('input[aria-label="生效条件表达式"]')).toBe(input);
  expect(input.value).toBe("terminalFocus &&");
  expect(document.body.textContent).toContain("请使用变量、!、&&、|| 和括号编写表达式。");
  expect(state.upsert).not.toHaveBeenCalled();
  await type(input, "terminalFocus && !isWeb");
  expect(document.body.textContent).not.toContain("请使用变量、!、&&、|| 和括号编写表达式。");
  expect(document.body.textContent).toContain("且");
  await act(async () => button("保存").click());
  expect(state.upsert).toHaveBeenCalledWith({
    environmentId: "primary",
    input: {
      command: "sidebar.toggle",
      key: "mod+b",
      when: "terminalFocus && !isWeb",
      replace: { command: "sidebar.toggle", key: "mod+b" },
    },
  });
});

it("keeps Chinese searches working after switching to English and preserves the native row destination", async () => {
  await render();
  await language("zh");
  await type(search(), "复制链接");
  expect(container.textContent).toContain("拉取请求：复制链接或会话 ID");
  const row = container.querySelector("#keybinding-thread\\.copyReference");
  await language("en");
  expect(search().value).toBe("复制链接");
  expect(container.textContent).toContain("Pull Request: Copy Link or Thread ID");
  expect(container.querySelector("#keybinding-thread\\.copyReference")).toBe(row);
  expect(state.upsert).not.toHaveBeenCalled();
});

it("uses the current language for a pending failure and retains the shortcut for retry", async () => {
  let resolve!: (value: unknown) => void;
  state.upsert.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
  await render();
  await editSidebar();
  await key(capture(), { key: "K", code: "KeyK", ctrlKey: true });
  await click("Save");
  await language("zh");
  await act(async () =>
    resolve(AsyncResult.failure(Cause.fail(new Error("raw server diagnostic")))),
  );
  expect(state.toast).toHaveBeenCalledExactlyOnceWith({
    type: "error",
    title: "无法保存快捷键",
    description: "raw server diagnostic",
  });
  expect(capture().value).toBe("mod+k");
  expect(button("保存").disabled).toBe(false);
  expect(state.upsert).toHaveBeenCalledTimes(2);
});

it("selects a translated new command while preserving its value and cancels without writes", async () => {
  await render();
  await language("zh");
  await click("添加快捷键");
  await click("动作");
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (node) => node.textContent?.trim() === "导航：后退",
  )!;
  await act(async () => option.click());
  expect(button("导航：后退")).toBeDefined();
  await act(async () => capture().focus());
  await language("en");
  expect(button("Navigation: Back")).toBeDefined();
  await key(capture(), { key: "F8", code: "F8" });
  await click("Save");
  expect(state.upsert).toHaveBeenCalledWith({
    environmentId: "second",
    input: { command: "navigation.back", key: "f8" },
  });
  await click("Add keybinding");
  await click("Cancel new keybinding");
  expect(state.upsert).toHaveBeenCalledTimes(2);
  expect(capture()).toBeNull();
});

it("keeps permission checks effective when a grant is revoked after editing in Chinese", async () => {
  await render();
  await editSidebar();
  await key(capture(), { key: "K", code: "KeyK", ctrlKey: true });
  state.denied.add("second");
  await language("zh");
  expect(container.textContent).toContain("此连接可查看快捷键，但无法修改。");
  expect(button("添加快捷键").disabled).toBe(true);
  // jsdom does not implement inert; the retained command still checks grants.
  await click("保存");
  expect(state.upsert).not.toHaveBeenCalled();
});

it("checks conflicts against every binding after filtering and retranslates their labels", async () => {
  await render();
  await editSidebar();
  // mod+j belongs to terminal.toggle, which the sidebar filter hides.
  await key(capture(), { key: "j", code: "KeyJ", ctrlKey: true });
  expect(container.querySelector('[aria-label="Conflicts with Terminal: Toggle."]')).not.toBeNull();
  await language("zh");
  expect(container.querySelector('[aria-label="与 终端：显示或隐藏 冲突。"]')).not.toBeNull();
  expect(search().value).toBe("sidebar.toggle");
  expect(capture().value).toBe("mod+j");
  expect(state.upsert).not.toHaveBeenCalled();
});
