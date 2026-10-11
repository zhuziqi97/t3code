// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { AsyncResult } from "effect/reactivity";
import { EnvironmentId, type DeviceServiceState, type DeviceHostSummary } from "@t3tools/contracts";

const api = vi.hoisted(() => ({ configure: vi.fn(), list: vi.fn(), test: vi.fn(), allowed: true }));
vi.mock("../../state/device", () => ({
  deviceEnvironment: { configure: api.configure, list: api.list, testHost: api.test },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => api.allowed,
  readEnvironmentScope: () => api.allowed,
}));

import { changeLanguage } from "../../i18n";
import { DeviceSetup } from "./DeviceSetup";
import { DeviceHostUpdates } from "./DeviceHostUpdates";
import { DeviceToolVersions } from "./DeviceToolVersions";
import { DeviceHostEditor } from "../settings/DeviceHostEditor";
import { Dialog } from "../ui/dialog";
import { WizardPopup } from "../ui/wizard";

const envA = EnvironmentId.make("native-a");
const envB = EnvironmentId.make("native-b");
const targets = [
  { environmentId: envA, label: "Native A", connected: true },
  { environmentId: envB, label: "Native B", connected: true },
];
const host = { id: "native-host", label: "Raw host", target: "user@raw-host" };
const summary: DeviceHostSummary = {
  ...host,
  kind: "ssh",
  platforms: [{ platform: "ios", available: true }],
  hubInstalled: true,
  agentDeviceInstalled: true,
};
const tools = {
  hub: {
    requiredVersion: "1.20.0",
    runningVersion: "1.2.0",
    installedVersions: ["1.2.0", "1.20.0"],
  },
  agent: { requiredVersion: "9.0.0", runningVersion: null, installedVersions: ["8.0.0"] },
};
const deviceState = (patch: Partial<DeviceServiceState> = {}): DeviceServiceState => ({
  hosts: [{ ...summary, id: "local", kind: "local", tools }],
  hostStatus: "ready",
  hostStatuses: {},
  devices: [],
  sessions: [],
  onboardingCompleted: false,
  agentAccessEnabled: false,
  hubBasePath: "/api/device-hub",
  revision: 0,
  ...patch,
});

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  api.allowed = true;
  for (const fn of [api.configure, api.list, api.test])
    fn.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
  vi.unstubAllGlobals();
});
const render = async (node: ReactNode) => act(async () => root.render(node));
const language = async (lang: "en" | "zh") => act(async () => changeLanguage(lang));
function button(label: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>('button, [role="switch"]')].find(
    (node) => node.getAttribute("aria-label") === label || node.textContent?.trim() === label,
  );
  expect(result, label).toBeDefined();
  return result!;
}
const click = async (label: string) => act(async () => button(label).click());
const type = async (input: HTMLInputElement, value: string) =>
  act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const field = (label: string) => {
  const result = [...document.querySelectorAll("label")]
    .find((node) => node.querySelector("span")?.textContent === label)
    ?.querySelector("input");
  expect(result, label).toBeDefined();
  return result!;
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

it("preserves SSH drafts and independent pending checks through language changes and saves native values", async () => {
  const a = deferred<DeviceHostSummary>();
  const b = deferred<DeviceHostSummary>();
  api.test.mockImplementation(({ environmentId }: { environmentId: EnvironmentId }) =>
    (environmentId === envA ? a.promise : b.promise).then((value) => AsyncResult.success(value)),
  );
  const save = vi.fn();
  await render(
    <DeviceHostEditor
      host={host}
      isNew={false}
      targets={targets}
      busy={false}
      onSave={save}
      onClose={vi.fn()}
    />,
  );
  const name = field("Name");
  const target = field("SSH target");
  await type(name, "Raw renamed");
  await type(target, "dev@build-host");
  const details = document.querySelector<HTMLDetailsElement>("details")!;
  await act(async () => {
    details.open = true;
  });
  await type(field("Identity file"), " ~/.ssh/raw key ");
  await type(field("Port"), "2222");
  await click("Test connection");
  expect(api.test).toHaveBeenCalledTimes(2);
  expect(button("Save host").disabled).toBe(true);
  await language("zh");
  expect(field("名称")).toBe(name);
  expect(field("SSH 目标")).toBe(target);
  expect(target.value).toBe("dev@build-host");
  expect(name.value).toBe("Raw renamed");
  expect(details.open).toBe(true);
  expect(button("保存主机").disabled).toBe(true);
  expect(api.test).toHaveBeenCalledTimes(2);
  expect(save).not.toHaveBeenCalled();
  await act(async () => {
    a.resolve({
      ...summary,
      platforms: [
        { platform: "ios", available: false },
        { platform: "android", available: true },
      ],
    });
  });
  expect(document.body.textContent).toContain("iOS 不可用");
  expect(document.body.textContent).toContain("Android 可用");
  expect(button("保存主机").disabled).toBe(true);
  await act(async () => b.reject(new Error("SSH key rejected: raw diagnostic")));
  expect(document.body.textContent).toContain("2 个中有 1 个失败");
  expect(document.body.textContent).toContain("SSH key rejected: raw diagnostic");
  expect(api.test.mock.calls).toEqual(
    targets.map(({ environmentId }) => [
      {
        environmentId,
        input: {
          ...host,
          label: "Raw renamed",
          target: "dev@build-host",
          identityFile: "~/.ssh/raw key",
          port: 2222,
        },
      },
    ]),
  );
  await click("保存主机");
  expect(save).toHaveBeenCalledExactlyOnceWith({
    ...host,
    label: "Raw renamed",
    target: "dev@build-host",
    identityFile: "~/.ssh/raw key",
    port: 2222,
  });
});

it("retranslates a retained local permission failure and cancel does not save or probe again", async () => {
  api.allowed = false;
  const save = vi.fn();
  const close = vi.fn();
  await render(
    <DeviceHostEditor
      host={host}
      isNew={true}
      targets={[targets[0]!]}
      busy={false}
      onSave={save}
      onClose={close}
    />,
  );
  await click("Test connection");
  expect(api.test).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("This connection cannot test device hosts.");
  await language("zh");
  expect(document.body.textContent).toContain("此连接无权测试设备主机。");
  expect(document.body.textContent).toContain("Native A");
  await click("取消");
  expect(close).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  expect(api.test).not.toHaveBeenCalled();
});

it("keeps wizard step identity, native operations and one completion while switching languages", async () => {
  const ready = deviceState();
  const complete = vi.fn();
  const view = (state: DeviceServiceState) => (
    <Dialog open>
      <WizardPopup>
        <DeviceSetup environmentId={envA} state={state} onComplete={complete} />
      </WizardPopup>
    </Dialog>
  );
  await render(view(ready));
  await click("Continue");
  const step = button("Simulators, step 2");
  await act(async () => step.focus());
  await language("zh");
  expect(button("模拟器，第 2 步")).toBe(step);
  expect(document.activeElement).toBe(step);
  expect(api.configure).not.toHaveBeenCalled();
  expect(api.list).not.toHaveBeenCalled();
  const checking = deferred<ReturnType<typeof AsyncResult.success<undefined>>>();
  api.list.mockReturnValueOnce(checking.promise);
  await click("重新检查");
  expect(api.list).toHaveBeenCalledExactlyOnceWith({ environmentId: envA, input: {} });
  await language("en");
  expect(button("Checking…").disabled).toBe(true);
  expect(button("Continue").disabled).toBe(true);
  expect(api.list).toHaveBeenCalledOnce();
  await act(async () => checking.resolve(AsyncResult.success(undefined)));
  await click("Continue");
  await language("zh");
  await click("允许智能体控制设备");
  expect(api.configure).toHaveBeenCalledExactlyOnceWith({
    environmentId: envA,
    input: { agentAccessEnabled: true },
  });
  await render(view({ ...ready, agentAccessEnabled: true }));
  const saving = deferred<ReturnType<typeof AsyncResult.success<undefined>>>();
  api.configure.mockReturnValueOnce(saving.promise);
  await click("完成");
  await language("en");
  expect(button("Saving…").disabled).toBe(true);
  expect(api.configure).toHaveBeenCalledTimes(2);
  expect(complete).not.toHaveBeenCalled();
  await act(async () => saving.resolve(AsyncResult.success(undefined)));
  expect(complete).toHaveBeenCalledOnce();
  expect(api.configure.mock.calls[1]).toEqual([
    { environmentId: envA, input: { onboardingCompleted: true } },
  ]);
});

it("keeps version details open and filters by native tool kind with raw versions and owner", async () => {
  await render(<DeviceToolVersions tools={tools} kind="hub" owner="Raw owner" />);
  await click("Device hub: version 1.2.0. Show details");
  expect(document.body.textContent).toContain("1.20.0");
  expect(document.body.textContent).not.toContain("9.0.0");
  const popup =
    document.querySelector<HTMLElement>('[data-slot="popover-content"]') ??
    document.querySelector<HTMLElement>('[data-slot="popover-popup"]');
  expect(popup).not.toBeNull();
  await language("zh");
  expect(document.body.textContent).toContain("所需版本");
  expect(document.body.textContent).toContain("Raw owner");
  expect(document.body.textContent).not.toContain("9.0.0");
  expect(document.body.textContent).toContain("1.20.0");
  expect(popup!.isConnected).toBe(true);
  expect(api.list).not.toHaveBeenCalled();
  expect(api.configure).not.toHaveBeenCalled();
});

it("keeps host retry pending once across locale changes and preserves SSH diagnostics", async () => {
  const retry = deferred<ReturnType<typeof AsyncResult.success<undefined>>>();
  api.list.mockReturnValueOnce(retry.promise);
  const state = deviceState({
    hosts: [summary],
    supportsHostRetry: true,
    hostStatuses: { [host.id]: { status: "failed", detail: "SSH raw failure: user@raw-host" } },
  });
  await render(<DeviceHostUpdates state={state} environmentId={envA} />);
  await click("Retry");
  await language("zh");
  expect(button("正在重试…").disabled).toBe(true);
  expect(document.body.textContent).toContain("SSH raw failure: user@raw-host");
  expect(api.list).toHaveBeenCalledExactlyOnceWith({
    environmentId: envA,
    input: { retryHostId: host.id },
  });
  await act(async () => retry.resolve(AsyncResult.success(undefined)));
  expect(button("重试").disabled).toBe(false);
  expect(api.list).toHaveBeenCalledOnce();
});
