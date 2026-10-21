import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../../test/render";

import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  auth: { isLoaded: true, isSignedIn: false, userId: null as string | null },
  controller: {
    linkState: {
      target: { environmentId: "env-qa" },
      data: {
        linked: false,
        cloudUserId: null,
        managedTunnelActive: false,
        publishAgentActivity: false,
      },
      error: null,
    },
    operationError: null,
    reconcileCloudState: vi.fn(),
  },
  toast: vi.fn(),
  authListeners: new Set<() => void>(),
}));
vi.mock("@clerk/react", async (original) => {
  const { useSyncExternalStore } = await import("react");
  return {
    ...(await original<typeof import("@clerk/react")>()),
    useAuth: () =>
      useSyncExternalStore(
        (listener) => {
          state.authListeners.add(listener);
          return () => {
            state.authListeners.delete(listener);
          };
        },
        () => state.auth,
      ),
  };
});
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<typeof import("@effect/atom-react")>()),
  useAtomValue: () => ({ _tag: "Success" }),
}));
vi.mock("~/cloud/publicConfig", async (original) => ({
  ...(await original<typeof import("~/cloud/publicConfig")>()),
  hasCloudPublicConfig: () => true,
}));
vi.mock("~/cloud/useCloudLinkController", async (original) => ({
  ...(await original<typeof import("~/cloud/useCloudLinkController")>()),
  useCloudLinkController: () => state.controller,
}));
vi.mock("~/state/environments", async (original) => ({
  ...(await original<typeof import("~/state/environments")>()),
  useEnvironments: () => ({ isReady: true, environments: [] }),
  usePrimaryEnvironmentId: () => "env-qa",
  usePrimaryEnvironment: () => ({ environmentId: "env-qa" }),
}));
vi.mock("~/state/session", async (original) => ({
  ...(await original<typeof import("~/state/session")>()),
  environmentSession: { sessionStateAtom: () => null },
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock("./CloudEnvironmentConnectList", async (original) => ({
  ...(await original<typeof import("./CloudEnvironmentConnectList")>()),
  CloudEnvironmentConnectRows: () => <p>QA other devices 原文</p>,
}));
vi.mock("../ui/toast", async (original) => ({
  ...(await original<typeof import("../ui/toast")>()),
  toastManager: { add: state.toast },
}));
import { changeLanguage } from "../../i18n";
import { CONNECT_ONBOARDING_OPT_OUT_STORAGE_KEY } from "../../cloud/connectOnboarding";
import { ConnectOnboardingDialog } from "./ConnectOnboardingDialog";

let root: Screen;
let container: HTMLDivElement;
function button(label: string) {
  return [...document.querySelectorAll("button")].find((element) => element.textContent === label)!;
}

it("preserves publish choices while enabling and uses the completion language, then stores opt-out", async () => {
  await using _lifecycle = await setupLifecycle();

  let finish!: (ok: boolean) => void;
  state.controller.reconcileCloudState.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.rerender(<ConnectOnboardingDialog />));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => {
    state.auth = { ...state.auth, isSignedIn: true, userId: "account-raw" };
    for (const listener of state.authListeners) listener();
  });
  expect(document.body.textContent).toContain("Set up T3 Connect");
  const expose = document.querySelector<HTMLElement>(
    '[role="switch"][aria-label="Publish this environment"]',
  )!;
  await act(async () => expose.click());
  await act(async () => (document.querySelector('[role="checkbox"]') as HTMLElement).click());
  await act(async () => button("Continue").click());
  expect(state.controller.reconcileCloudState).toHaveBeenCalledExactlyOnceWith({
    managedTunnel: false,
    publish: true,
  });
  expect(button("Enabling…").disabled).toBe(true);
  await act(async () => changeLanguage("zh"));
  expect(document.body.textContent).toContain("设置 T3 Connect");
  expect(button("正在启用…").disabled).toBe(true);
  expect(
    document
      .querySelector('[role="switch"][aria-label="开放此执行环境的访问"]')
      ?.getAttribute("aria-checked"),
  ).toBe("false");
  expect(document.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("true");
  await act(async () => finish(true));
  expect(state.toast).toHaveBeenCalledWith({
    type: "success",
    title: "已启用 T3 Connect",
    description: "此执行环境已开始向移动客户端推送智能体活动。",
  });
  expect(document.body.textContent).toContain("QA other devices 原文");
  await act(async () => button("完成").click());
  expect(JSON.parse(window.localStorage.getItem(CONNECT_ONBOARDING_OPT_OUT_STORAGE_KEY)!)).toEqual({
    optOutAccounts: ["account-raw"],
  });
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.localStorage.removeItem(CONNECT_ONBOARDING_OPT_OUT_STORAGE_KEY);
    vi.unstubAllGlobals();
    await changeLanguage("en");
  });

  vi.clearAllMocks();

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
  window.localStorage.removeItem(CONNECT_ONBOARDING_OPT_OUT_STORAGE_KEY);
  state.auth = { isLoaded: true, isSignedIn: false, userId: null };
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));

  renderStack = stack.move();
  return renderStack;
}
