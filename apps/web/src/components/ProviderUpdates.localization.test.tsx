// @vitest-environment jsdom
import { act, useSyncExternalStore, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { LocalEnvironmentUpdateGroup } from "./ProviderUpdateLaunchNotification.logic";

type ToastOptions = {
  title: ReactNode;
  description: ReactNode;
  actionProps?: ComponentPropsWithoutRef<"button">;
  data?: { secondaryActionProps?: ComponentPropsWithoutRef<"button"> };
};
const state = vi.hoisted(() => ({
  providers: [] as ServerProvider[],
  groups: [] as LocalEnvironmentUpdateGroup[],
  environments: [] as {
    environmentId: EnvironmentId;
    label: string;
    connection: { phase: string };
    entry: { target: { _tag: string; connectionId?: string } };
    serverConfig: { providers: ServerProvider[] };
  }[],
  primary: { environmentId: "raw-primary" as EnvironmentId },
  permitted: new Set<EnvironmentId>(),
  dismissed: new Set<string>(),
  dismiss: vi.fn(),
  updateProvider: vi.fn(),
  navigate: vi.fn(),
  toasts: new Map<string, ToastOptions>(),
  revision: 0,
  listeners: new Set<() => void>(),
  add: vi.fn(),
  update: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.providers }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
vi.mock("../state/server", () => ({
  primaryServerProvidersAtom: "controlled-primary-providers",
  serverEnvironment: { updateProvider: "controlled-provider-update" },
}));
vi.mock("../state/environments", () => ({
  usePrimaryEnvironment: () => state.primary,
  useEnvironments: () => ({ environments: state.environments }),
}));
vi.mock("../state/session", () => ({
  useEnvironmentScope: (id: EnvironmentId) => state.permitted.has(id),
  readEnvironmentScope: (id: EnvironmentId) => state.permitted.has(id),
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => state.updateProvider }));
vi.mock("../providerUpdateDismissal", () => ({
  useDismissedProviderUpdateNotificationKeys: () => ({
    dismissedNotificationKeys: state.dismissed,
    dismissNotificationKey: state.dismiss,
  }),
}));
vi.mock("./ProviderUpdateLaunchNotification.environments", () => ({
  useLocalEnvironmentUpdateGroups: () => ({ groups: state.groups, isAnySettling: false }),
}));
vi.mock("./chat/ProviderInstanceIcon", () => ({ ProviderInstanceIcon: () => null }));
// Retain the original React nodes just as the toast manager does. The real
// notification components and translation hooks must update these mounted nodes.
vi.mock("./ui/toast", () => ({
  toastManager: { add: state.add, update: state.update, close: state.close },
  stackedThreadToast: (options: ToastOptions) => options,
  hiddenToastActionProps: { hidden: true },
}));

import { changeLanguage } from "../i18n";
import { buildLocalEnvironmentUpdateGroups } from "./ProviderUpdateLaunchNotification.logic";
import { ProviderUpdatePrimaryNotification } from "./ProviderUpdatePrimaryNotification";
import { ProviderUpdateLaunchNotification } from "./ProviderUpdateLaunchNotification";
import { ProviderUpdateEnvironmentRows } from "./ProviderUpdateEnvironmentRows";
import { ProviderUpdatesAction } from "./ProviderUpdatesAction";
import { SidebarProviderUpdatePill } from "./sidebar/SidebarProviderUpdatePill";

let root: Root;
let container: HTMLDivElement;
let version = 0;
const primaryId = EnvironmentId.make("raw-primary");
const secondaryId = EnvironmentId.make("raw-wsl-ubuntu");
function provider(driver: string, canUpdate = true): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(`${driver}-personal`),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-10T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    versionAdvisory: {
      status: "behind_latest",
      currentVersion: "1.0.0",
      latestVersion: `2.0.${++version}`,
      canUpdate,
      updateCommand: "npm install -g raw-provider",
      checkedAt: "2026-10-10T00:00:00.000Z",
      message: "Update available.",
    },
  };
}
function terminal(
  source: ServerProvider,
  status: "succeeded" | "failed",
  message = "Provider updated.",
): ServerProvider {
  return {
    ...source,
    ...(status === "succeeded" ? { version: source.versionAdvisory?.latestVersion ?? null } : {}),
    updateState: {
      status,
      startedAt: "2026-10-10T00:00:00.000Z",
      finishedAt: "2026-10-10T00:01:00.000Z",
      message,
      output: null,
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
type UpdateResult = AtomCommandResult<
  { readonly providers: ReadonlyArray<ServerProvider> },
  unknown
>;
function publish() {
  state.revision++;
  for (const listener of state.listeners) listener();
}
function ToastHost() {
  useSyncExternalStore(
    (listener) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    () => state.revision,
  );
  return (
    <>
      {[...state.toasts].map(([id, toast]) => (
        <section key={id} aria-label="Provider notification">
          <h2>{toast.title}</h2>
          <div>{toast.description}</div>
          {toast.actionProps && <button type="button" {...toast.actionProps} />}
          {toast.data?.secondaryActionProps && (
            <button type="button" {...toast.data.secondaryActionProps} />
          )}
        </section>
      ))}
    </>
  );
}
async function render(children: ReactNode) {
  await act(async () =>
    root.render(
      <>
        {children}
        <ToastHost />
      </>,
    ),
  );
}
function button(label: string, parent: ParentNode = container) {
  const result = [...parent.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent === label,
  );
  expect(result, `visible button: ${label}`).toBeDefined();
  return result!;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function language(language: "en" | "zh") {
  await act(async () => {
    await changeLanguage(language);
  });
}
function configureEnvironments(providers: ServerProvider[], secondary: ServerProvider[]) {
  state.environments = [
    {
      environmentId: primaryId,
      label: "Windows raw host",
      connection: { phase: "connected" },
      entry: { target: { _tag: "PrimaryConnectionTarget" } },
      serverConfig: { providers },
    },
    {
      environmentId: secondaryId,
      label: "WSL (Ubuntu raw)",
      connection: { phase: "connected" },
      entry: { target: { _tag: "BearerConnectionTarget", connectionId: "local:wsl:Ubuntu" } },
      serverConfig: { providers: secondary },
    },
  ];
  state.groups = buildLocalEnvironmentUpdateGroups(
    state.environments.map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      isPrimary: environment.environmentId === primaryId,
      connectionState: "ready",
      providers: environment.serverConfig.providers,
    })),
  ).groups;
}
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
  HTMLElement.prototype.getAnimations = () => [];
  await changeLanguage("en");
  state.providers = [];
  state.groups = [];
  state.environments = [];
  state.permitted = new Set([primaryId, secondaryId]);
  state.toasts.clear();
  state.listeners.clear();
  state.revision = 0;
  for (const mock of [
    state.updateProvider,
    state.navigate,
    state.dismiss,
    state.add,
    state.update,
    state.close,
  ])
    mock.mockReset();
  state.add.mockImplementation((options: ToastOptions) => {
    const id = `toast-${state.add.mock.calls.length}`;
    state.toasts.set(id, options);
    publish();
    return id;
  });
  state.update.mockImplementation((id: string, options: ToastOptions) => {
    state.toasts.set(id, options);
    publish();
  });
  state.close.mockImplementation((id: string) => {
    state.toasts.delete(id);
    publish();
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("retranslates a retained primary prompt without recreating it or starting an update", async () => {
  const codex = provider("codex");
  state.providers = [codex];
  await render(<ProviderUpdatePrimaryNotification />);
  expect(container.textContent).toContain(
    `Update Available: Codex v${codex.versionAdvisory?.latestVersion}`,
  );
  await language("zh");
  expect(container.textContent).toContain(`可更新：Codex v${codex.versionAdvisory?.latestVersion}`);
  expect(container.textContent).toContain("立即更新，或前往提供方设置查看详情。");
  expect(state.add).toHaveBeenCalledTimes(1);
  expect(state.update).not.toHaveBeenCalled();
  expect(state.updateProvider).not.toHaveBeenCalled();
  await click(button("设置"));
  expect(state.navigate).toHaveBeenCalledWith({ to: "/settings/providers" });
  expect(container.querySelector("section")).toBeNull();
});

it("keeps sequential targets and raw CLI errors while the language changes during an update", async () => {
  const codex = provider("codex");
  const claude = provider("claudeAgent");
  state.providers = [codex, claude];
  const first = deferred<UpdateResult>();
  const second = deferred<UpdateResult>();
  state.updateProvider.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await render(<ProviderUpdatePrimaryNotification />);
  await click(button("Update"));
  await language("zh");
  expect(state.updateProvider).toHaveBeenCalledTimes(1);
  await act(async () =>
    first.resolve(AsyncResult.success({ providers: [terminal(codex, "succeeded")] })),
  );
  expect(state.updateProvider).toHaveBeenNthCalledWith(2, {
    environmentId: primaryId,
    input: { provider: claude.driver, instanceId: claude.instanceId },
  });
  const raw = "raw npm EACCES: /raw/provider path";
  await act(async () => second.resolve(AsyncResult.failure(Cause.fail(new Error(raw)))));
  expect(container.textContent).toContain("提供方更新失败");
  expect(container.textContent).toContain(raw);
  await language("en");
  expect(container.textContent).toContain("Provider updates failed");
  expect(container.textContent).toContain(raw);
  expect(state.updateProvider).toHaveBeenCalledTimes(2);
  expect(state.add).toHaveBeenCalledTimes(2);
});

it("stops the next primary update after permission is revoked and retranslates the stored failure", async () => {
  const codex = provider("codex");
  state.providers = [codex, provider("claudeAgent")];
  const first = deferred<UpdateResult>();
  state.updateProvider.mockReturnValueOnce(first.promise);
  await render(<ProviderUpdatePrimaryNotification />);
  await click(button("Update"));
  state.permitted.delete(primaryId);
  await render(<ProviderUpdatePrimaryNotification />);
  await language("zh");
  await act(async () =>
    first.resolve(AsyncResult.success({ providers: [terminal(codex, "succeeded")] })),
  );
  expect(container.textContent).toContain("此连接无权管理提供方账户。");
  await language("en");
  expect(container.textContent).toContain("This connection cannot manage provider accounts.");
  expect(state.updateProvider).toHaveBeenCalledTimes(1);
});

it("preserves an environment row's pending request, retry and native target across language changes", async () => {
  const codex = provider("codex");
  configureEnvironments([], [codex]);
  const update = deferred<UpdateResult>();
  state.updateProvider.mockReturnValueOnce(update.promise);
  await render(<ProviderUpdateEnvironmentRows />);
  await click(button("Update"));
  await language("zh");
  expect(container.textContent).toContain("WSL (Ubuntu raw)");
  expect(container.textContent).toContain("正在更新…");
  expect(state.updateProvider).toHaveBeenCalledTimes(1);
  await act(async () =>
    update.resolve(
      AsyncResult.success({
        providers: [terminal(codex, "failed", "Update command exited with code 17.")],
      }),
    ),
  );
  expect(container.textContent).toContain("更新命令已退出，退出码为 17。");
  await language("en");
  expect(container.textContent).toContain("Update command exited with code 17.");
  state.permitted.delete(secondaryId);
  await render(<ProviderUpdateEnvironmentRows />);
  expect(button("Retry").disabled).toBe(true);
  await click(button("Retry"));
  expect(state.updateProvider).toHaveBeenCalledTimes(1);
  state.permitted.add(secondaryId);
  state.updateProvider.mockResolvedValueOnce(
    AsyncResult.success({ providers: [terminal(codex, "succeeded")] }),
  );
  await render(<ProviderUpdateEnvironmentRows />);
  await click(button("Retry"));
  await language("zh");
  expect(container.textContent).toContain("已更新");
  expect(state.updateProvider).toHaveBeenLastCalledWith({
    environmentId: secondaryId,
    input: { provider: codex.driver, instanceId: codex.instanceId },
  });
  expect(state.updateProvider).toHaveBeenCalledTimes(2);
});

it("retranslates the multi-environment launch toast and keeps the in-flight row mounted", async () => {
  const codex = provider("codex");
  configureEnvironments([provider("claudeAgent")], [codex]);
  const update = deferred<UpdateResult>();
  state.updateProvider.mockReturnValueOnce(update.promise);
  await render(<ProviderUpdateLaunchNotification />);
  expect(container.textContent).toContain("Updates Available: 2 providers");
  const secondaryRow = [...container.querySelectorAll<HTMLDivElement>("div")].find(
    (element) =>
      element.querySelector("button") && element.textContent?.startsWith("WSL (Ubuntu raw)"),
  )!;
  await click(button("Update", secondaryRow));
  await language("zh");
  expect(container.textContent).toContain("2 个提供方可更新");
  expect(container.textContent).toContain("正在更新…");
  expect(state.add).toHaveBeenCalledTimes(1);
  expect(state.updateProvider).toHaveBeenCalledTimes(1);
  await act(async () =>
    update.resolve(AsyncResult.success({ providers: [terminal(codex, "succeeded")] })),
  );
  expect(container.textContent).toContain("已更新");
  await click(button("设置"));
  expect(state.navigate).toHaveBeenCalledWith({ to: "/settings/providers" });
});

it("retranslates sidebar success without restarting its dismissal timer or reviving a dismissed result", async () => {
  vi.useFakeTimers();
  const codex = terminal(provider("codex"), "succeeded");
  state.providers = [codex];
  await render(<SidebarProviderUpdatePill />);
  expect(container.textContent).toContain(`Codex updated: v${codex.version}`);
  await act(async () => vi.advanceTimersByTime(2500));
  await language("zh");
  expect(container.textContent).toContain(`Codex 已更新至 v${codex.version}`);
  const main = container.querySelector<HTMLButtonElement>("[data-provider-update-main]")!;
  expect(main.getAttribute("aria-label")).toBe("新会话将使用更新后的提供方。");
  await act(async () => vi.advanceTimersByTime(500));
  const pill = main.closest<HTMLDivElement>(".group\\/provider-update")!;
  expect(pill.className).toContain("opacity-0");
  // Text can still change during the outgoing transition without replacing its key.
  await language("en");
  expect(main.textContent).toContain(`Codex updated: v${codex.version}`);
  await act(async () => pill.dispatchEvent(new Event("transitionend", { bubbles: true })));
  expect(container.querySelector("[data-provider-update-main]")).toBeNull();
  await language("zh");
  expect(container.querySelector("[data-provider-update-main]")).toBeNull();
  expect(state.updateProvider).not.toHaveBeenCalled();
});

it("keeps one update per machine and retranslates the partial result while retaining raw machine names and errors", async () => {
  const codex = provider("codex");
  const claude = provider("claudeAgent");
  configureEnvironments([codex], [claude]);
  const first = deferred<UpdateResult>();
  const second = deferred<UpdateResult>();
  state.updateProvider.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await render(<ProviderUpdatesAction />);
  await click(button("Update all"));
  await language("zh");
  expect(button("正在更新…").disabled).toBe(true);
  expect(state.updateProvider).toHaveBeenCalledTimes(2);
  await act(async () => {
    first.resolve(AsyncResult.success({ providers: [terminal(codex, "succeeded")] }));
    second.resolve(AsyncResult.failure(Cause.fail(new Error("raw CLI exit: /native path"))));
  });
  expect(container.textContent).toContain("2 项提供方更新中有 1 项失败");
  expect(container.textContent).toContain("WSL (Ubuntu raw) · Claude: raw CLI exit: /native path");
  await language("en");
  expect(container.textContent).toContain("1 of 2 provider updates failed");
  expect(state.updateProvider.mock.calls).toEqual([
    [{ environmentId: primaryId, input: { provider: codex.driver, instanceId: codex.instanceId } }],
    [
      {
        environmentId: secondaryId,
        input: { provider: claude.driver, instanceId: claude.instanceId },
      },
    ],
  ]);
  expect(state.add).toHaveBeenCalledTimes(1);
});
