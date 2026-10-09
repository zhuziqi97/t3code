// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProviderInstanceId,
  ProviderDriverKind,
  type ProviderAuthState,
  type ProviderInstallState,
  type ServerProvider,
} from "@t3tools/contracts";

const state = vi.hoisted(() => ({
  auth: null as ProviderAuthState | null,
  installation: null as ProviderInstallState | null,
  respond: vi.fn(),
  start: vi.fn(),
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    providerAuthState: () => "auth",
    providerInstallState: () => "install",
    startProviderInstall: vi.fn(),
    cancelProviderInstall: vi.fn(),
    removeProviderInstallation: vi.fn(),
    startProviderAuth: state.start,
    respondProviderAuth: state.respond,
    completeProviderAuth: vi.fn(),
    cancelProviderAuth: vi.fn(),
    logoutProviderAuth: vi.fn(),
  },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: string) => ({
    data: query === "install" ? state.installation : state.auth,
    error: null,
  }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("./settingsLayout", () => ({
  SettingsRow: ({
    title,
    description,
    status,
    control,
    children,
  }: {
    title: ReactNode;
    description: ReactNode;
    status: ReactNode;
    control: ReactNode;
    children: ReactNode;
  }) => (
    <section>
      <h3>{title}</h3>
      {description}
      {status}
      {control}
      {children}
    </section>
  ),
}));
import { changeLanguage } from "../../i18n";
import { ProviderSetupSection } from "./ProviderSetupSection";
import { ProviderAuthenticationSection } from "./ProviderAuthenticationSection";
const environmentId = EnvironmentId.make("controlled-environment");
const instanceId = ProviderInstanceId.make("controlled-provider");
const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("antigravity"),
  installed: true,
  enabled: true,
  version: "test-version",
  status: "error",
  auth: { status: "unauthenticated" },
  checkedAt: "2026-10-10T00:00:00.000Z",
  models: [],
  skills: [],
  slashCommands: [],
  setup: { canAuthenticate: true, canInstall: true },
};
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLanguage("en");
  state.respond.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  state.start.mockReset();
  state.auth = {
    instanceId,
    phase: "waiting",
    flowId: "raw-flow",
    authorizationUrl: null,
    expiresAt: null,
    message: null,
    interaction: {
      type: "credentials",
      id: "raw-interaction",
      fields: [{ name: "raw-token-name", label: "Provider supplied label", secret: true }],
    },
  };
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
async function render() {
  await act(() =>
    root.render(
      <ProviderAuthenticationSection
        environmentId={environmentId}
        environmentLabel="Raw Host Name"
        instanceId={instanceId}
        provider={provider}
        readOnly={false}
      />,
    ),
  );
}
it("preserves credential drafts and submits to the same environment after switching language", async () => {
  await render();
  const input = container.querySelector<HTMLInputElement>("input")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(() => {
    setter.call(input, "Controlled-Raw-Credential");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await changeLanguage("zh");
  });
  expect(container.querySelector<HTMLInputElement>("input")?.value).toBe(
    "Controlled-Raw-Credential",
  );
  expect(container.textContent).toContain("在下方输入登录凭据。");
  expect(container.textContent).toContain("Provider supplied label");
  expect(state.respond).not.toHaveBeenCalled();
  await act(() =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(state.respond).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: {
      instanceId,
      flowId: "raw-flow",
      interactionId: "raw-interaction",
      response: { type: "credentials", values: { "raw-token-name": "Controlled-Raw-Credential" } },
    },
  });
  expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("");
  await act(async () => {
    await changeLanguage("en");
  });
  expect(container.textContent).toContain("Enter your credentials below.");
  expect(state.respond).toHaveBeenCalledTimes(1);
  expect(state.start).not.toHaveBeenCalled();
});
it("relocalizes a local sign-in error while keeping the draft available for retry", async () => {
  state.respond.mockRejectedValue({});
  await render();
  await act(() =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(container.textContent).toContain("Provider sign-in failed. Try again.");
  await act(async () => {
    await changeLanguage("zh");
  });
  expect(container.textContent).toContain("智能体提供方登录失败，请重试。");
  expect(state.respond).toHaveBeenCalledTimes(1);
});

it("suppresses a repeated source-language installation status after switching to Chinese", async () => {
  state.installation = {
    driver: ProviderDriverKind.make("antigravity"),
    operationId: null,
    phase: "idle",
    downloadedBytes: 0,
    totalBytes: null,
    version: "test-version",
    installedVersion: "test-version",
    canRemove: true,
    message: "Installed.",
  };
  await act(async () => {
    await changeLanguage("zh");
  });
  await act(() =>
    root.render(
      <ProviderSetupSection
        environmentId={environmentId}
        environmentLabel="Raw Host Name"
        instanceId={instanceId}
        provider={provider}
        enabled
        readOnly={false}
        onEnable={vi.fn()}
      />,
    ),
  );
  expect(container.textContent).toContain("已安装。");
  expect(container.textContent).not.toContain("Installed.");
  await act(async () => {
    await changeLanguage("en");
  });
  expect(container.textContent?.match(/Installed\./g)).toHaveLength(1);
});
