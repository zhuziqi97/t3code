import { fakeTimers } from "../../test/render";
import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../test/render";
import { useSyncExternalStore, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";

type ToastOptions = {
  title: ReactNode;
  description: ReactNode;
  actionProps?: ComponentPropsWithoutRef<"button">;
  data?: { secondaryActionProps?: ComponentPropsWithoutRef<"button"> };
};
const state = vi.hoisted(() => ({
  providers: [] as ServerProvider[],
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
  toastSnapshot: [] as Array<[string, ToastOptions]>,
  listeners: new Set<() => void>(),
  add: vi.fn(),
  update: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<typeof import("@effect/atom-react")>()),
  useAtomValue: () => state.providers,
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => state.navigate,
}));
vi.mock("../state/server", async (original) => ({
  ...(await original<typeof import("../state/server")>()),
  primaryServerProvidersAtom: "controlled-primary-providers",
  serverEnvironment: { updateProvider: "controlled-provider-update" },
}));
vi.mock("../state/environments", async (original) => ({
  ...(await original<typeof import("../state/environments")>()),
  usePrimaryEnvironment: () => state.primary,
  useEnvironments: () => ({ environments: state.environments }),
  useEnvironmentProviders: () =>
    new Map(state.environments.map((env) => [env.environmentId, env.serverConfig.providers])),
}));
vi.mock("../state/session", async (original) => ({
  ...(await original<typeof import("../state/session")>()),
  useEnvironmentScope: (id: EnvironmentId) => state.permitted.has(id),
  readEnvironmentScope: (id: EnvironmentId) => state.permitted.has(id),
}));
vi.mock("../state/use-atom-command", async (original) => ({
  ...(await original<typeof import("../state/use-atom-command")>()),
  useAtomCommand: () => state.updateProvider,
}));

vi.mock("./chat/ProviderInstanceIcon", async (original) => ({
  ...(await original<typeof import("./chat/ProviderInstanceIcon")>()),
  ProviderInstanceIcon: () => null,
}));
// Retain the original React nodes just as the toast manager does. The real
// notification components and translation hooks must update these mounted nodes.
vi.mock("./ui/toast", async (original) => ({
  ...(await original<typeof import("./ui/toast")>()),
  toastManager: { add: state.add, update: state.update, close: state.close },
  stackedThreadToast: (options: ToastOptions) => options,
  hiddenToastActionProps: { hidden: true },
}));

import { changeLanguage } from "../i18n";
import { ProviderUpdatesAction } from "./ProviderUpdatesAction";
import { SidebarProviderUpdatePill } from "./sidebar/SidebarProviderUpdatePill";

let root: Screen;
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
  state.toastSnapshot = [...state.toasts];
  for (const listener of state.listeners) listener();
}
function ToastHost() {
  const entries = useSyncExternalStore(
    (listener) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    () => state.toastSnapshot,
  );
  return (
    <>
      {entries.map(([id, toast]) => (
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
    root.rerender(
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
}

it("retranslates sidebar success without restarting its dismissal timer or reviving a dismissed result", async () => {
  await using _lifecycle = await setupLifecycle();

  using _timers = fakeTimers();
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
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(container.querySelector("[data-provider-update-main]")).toBeNull();
  await language("zh");
  expect(container.querySelector("[data-provider-update-main]")).toBeNull();
  expect(state.updateProvider).not.toHaveBeenCalled();
});

it("keeps one update per machine and retranslates the partial result while retaining raw machine names and errors", async () => {
  await using _lifecycle = await setupLifecycle();

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

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
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
  HTMLElement.prototype.getAnimations = () => [];
  await changeLanguage("en");
  state.providers = [];
  state.environments = [];
  state.permitted = new Set([primaryId, secondaryId]);
  state.toasts.clear();
  state.toastSnapshot = [];
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
  state.update.mockImplementation((id: string, options: Partial<ToastOptions>) => {
    state.toasts.set(id, { ...state.toasts.get(id)!, ...options });
    publish();
  });
  state.close.mockImplementation((id: string) => {
    state.toasts.delete(id);
    publish();
  });
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));

  renderStack = stack.move();
  return renderStack;
}
