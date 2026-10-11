// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, UsageLimitSourceId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

const state = vi.hoisted(() => ({ update: vi.fn(), cursor: vi.fn(), refresh: vi.fn() }));
vi.mock("../../hooks/useSettings", () => ({
  useUpdateEnvironmentSettings: (environmentId: EnvironmentId) => (patch: unknown) =>
    state.update(environmentId, patch),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({ environment: { platform: { os: "darwin" } } }),
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    updateSettings: "update",
    refreshProviders: "refresh",
    configValueAtom: () => "config",
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "update" ? state.cursor : state.refresh),
}));
vi.mock("./settingsLayout", () => ({
  SettingsRow: ({
    title,
    description,
    control,
  }: {
    title: ReactNode;
    description: ReactNode;
    control: ReactNode;
  }) => (
    <section>
      {title}
      {description}
      {control}
    </section>
  ),
  SettingsSection: ({
    headerAction,
    children,
  }: {
    headerAction: ReactNode;
    children: ReactNode;
  }) => (
    <section>
      {headerAction}
      {children}
    </section>
  ),
}));

import { changeLanguage, i18n } from "../../i18n";
import { AddUsageLimitSourceDialog } from "./AddUsageLimitSourceDialog";
import { UsageProviderSettings } from "./UsageProviderSettings";

const environmentId = EnvironmentId.make("controlled-remote-host");
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
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  await changeLanguage("en");
  state.update.mockReset();
  state.cursor.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.refresh.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  Reflect.deleteProperty(Element.prototype, "getAnimations");
  vi.unstubAllGlobals();
});
const render = async (node: ReactNode) => act(async () => root.render(node));
const switchLanguage = async (language: "en" | "zh") => act(async () => changeLanguage(language));
const click = async (node: HTMLElement) => act(async () => node.click());
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === label,
  )!;
const type = async (id: string, value: string) =>
  act(async () => {
    const input = document.querySelector<HTMLInputElement>(id)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

it("keeps hub credentials and URL drafts across a language switch and writes to the selected environment once", async () => {
  const onOpenChange = vi.fn();
  await render(
    <AddUsageLimitSourceDialog
      open
      onOpenChange={onOpenChange}
      environmentId={environmentId}
      environmentLabel="My raw remote host"
    />,
  );
  expect(button("Add hub").disabled).toBe(true);
  await type("#usage-source-url", "https://hub.example.test:8318/path");
  await type("#usage-source-key", "  controlled-key +/?  ");
  await type("#usage-source-label", "My raw quota hub");
  await switchLanguage("zh");
  expect(document.body.textContent).toContain("My raw remote host");
  expect(document.querySelector<HTMLInputElement>("#usage-source-key")!.value).toBe(
    "  controlled-key +/?  ",
  );
  expect(state.update).not.toHaveBeenCalled();
  await click(button("添加服务"));
  expect(state.update).toHaveBeenCalledExactlyOnceWith(environmentId, {
    usageLimitSources: {
      "cliproxy-hub.example.test-8318": {
        kind: "cliproxy",
        label: "My raw quota hub",
        url: "https://hub.example.test:8318/path",
        managementKey: "controlled-key +/?",
        enabled: true,
      },
    },
  });
  expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
});

it("requires translated removal confirmation and preserves the original source ID", async () => {
  await render(
    <UsageProviderSettings
      environmentId={environmentId}
      environmentLabel="My raw remote host"
      sources={{
        [UsageLimitSourceId.make("cliproxy-raw-source")]: {
          kind: "cliproxy",
          label: "My raw quota hub",
          url: "https://hub.example.test",
          managementKey: "",
          enabled: true,
        },
      }}
      cursorKeychainUsageEnabled={false}
      readOnly={false}
    />,
  );
  await click(button("Remove"));
  await switchLanguage("zh");
  expect(document.querySelector('[role="alertdialog"]')!.textContent).toContain(
    "移除 My raw quota hub？",
  );
  await click(button("取消"));
  expect(state.update).not.toHaveBeenCalled();
  await click(button(i18n.t("common.remove")));
  await click(button("移除服务"));
  expect(state.update).toHaveBeenCalledExactlyOnceWith(environmentId, {
    usageLimitSources: { "cliproxy-raw-source": null },
  });
});

it("preserves pending Cursor usage changes during a language switch and refreshes only after success", async () => {
  let finish: (result: ReturnType<typeof AsyncResult.success>) => void = () => undefined;
  state.cursor.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(
    <UsageProviderSettings
      environmentId={environmentId}
      environmentLabel="My raw remote host"
      sources={{}}
      cursorKeychainUsageEnabled={false}
      readOnly={false}
    />,
  );
  await click(document.querySelector<HTMLElement>('[role="switch"]')!);
  expect(state.cursor).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { patch: { cursorKeychainUsageEnabled: true } },
  });
  await switchLanguage("zh");
  expect(document.querySelector('[role="switch"]')!.getAttribute("aria-label")).toBe(
    "Cursor 账户用量",
  );
  expect(state.cursor).toHaveBeenCalledOnce();
  expect(state.refresh).not.toHaveBeenCalled();
  await act(async () => finish(AsyncResult.success(undefined)));
  expect(state.refresh).toHaveBeenCalledExactlyOnceWith({ environmentId, input: {} });
});
