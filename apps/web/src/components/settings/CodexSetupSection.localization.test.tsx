// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderAuthState,
  type ProviderInstallState,
  type ServerProvider,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

const state = vi.hoisted(() => ({
  auth: null as ProviderAuthState | null,
  installation: null as ProviderInstallState | null,
  start: vi.fn(),
  complete: vi.fn(),
  command: vi.fn(),
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    providerAuthState: () => "auth",
    providerInstallState: () => "installation",
    chatGptHandoffState: () => "handoff",
    startProviderAuth: state.start,
    completeProviderAuth: state.complete,
    refreshProviders: state.command,
    cancelProviderAuth: state.command,
    logoutProviderAuth: state.command,
    startProviderInstall: state.command,
    cancelProviderInstall: state.command,
    chatGptReconnectProfile: state.command,
    chatGptImportProfile: state.command,
  },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: string | null) => ({
    data: atom === "auth" ? state.auth : atom === "installation" ? state.installation : null,
    error: null,
    isPending: false,
  }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("../../state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("../../state/environments", () => ({
  useEnvironmentHttpBaseUrl: () => "https://controlled.remote.test",
  usePrimaryEnvironmentId: () => null,
  useEnvironment: () => null,
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
}));

import { changeLanguage, i18n } from "../../i18n";
import { CodexSetupSection } from "./CodexSetupSection";

const environmentId = EnvironmentId.make("controlled-remote");
const instanceId = ProviderInstanceId.make("codex_raw_instance");
const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  installed: true,
  enabled: true,
  version: "controlled-version",
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
  state.auth = {
    instanceId,
    phase: "idle",
    flowId: null,
    authorizationUrl: null,
    expiresAt: null,
    message: null,
  };
  state.installation = {
    driver: provider.driver,
    phase: "succeeded",
    operationId: null,
    downloadedBytes: 0,
    totalBytes: null,
    version: "controlled-version",
    installedVersion: "controlled-version",
    source: "local",
    canRemove: false,
    message: null,
  };
  state.start.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.complete.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.command.mockReset().mockResolvedValue(AsyncResult.success(undefined));
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
const render = async () =>
  act(async () =>
    root.render(
      <CodexSetupSection
        environmentId={environmentId}
        instanceId={instanceId}
        provider={provider}
        mode="managed"
        enabled
        onModeChange={() => undefined}
      />,
    ),
  );
const click = async (node: HTMLElement) => act(async () => node.click());
const switchLanguage = async (language: "en" | "zh") => act(async () => changeLanguage(language));
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === label,
  )!;

it("retranslates owned sign-in errors without retrying authentication on a language switch", async () => {
  state.start.mockRejectedValue("controlled failure");
  await render();
  await click(button("Continue with ChatGPT"));
  expect(state.start).toHaveBeenCalledOnce();
  expect(state.start).toHaveBeenCalledWith({
    environmentId,
    input: expect.objectContaining({ instanceId, methodId: "chatgpt", callbackMode: "client" }),
  });
  expect(container.querySelector('[role="alert"]')!.textContent).toBe(
    i18n.getFixedT("en")("setup.codex.failure"),
  );
  await switchLanguage("zh");
  expect(container.querySelector('[role="alert"]')!.textContent).toBe(
    i18n.getFixedT("zh")("setup.codex.failure"),
  );
  expect(state.start).toHaveBeenCalledOnce();
  expect(state.complete).not.toHaveBeenCalled();
});

it("keeps redirect drafts and native flow IDs while switching language during a pending completion", async () => {
  const flowId = "controlled-flow";
  state.auth = {
    ...state.auth!,
    phase: "waiting",
    flowId,
    authorizationUrl: "https://auth.example.test/authorize",
  };
  let finish: (result: ReturnType<typeof AsyncResult.success>) => void = () => undefined;
  state.complete.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  const input = container.querySelector<HTMLInputElement>('input[type="password"]')!;
  const callbackUrl = "http://localhost:1455/auth/callback?code=controlled-code&state=raw-state";
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      callbackUrl,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await switchLanguage("zh");
  expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe(
    callbackUrl,
  );
  expect(state.complete).not.toHaveBeenCalled();
  await click(button(i18n.t("common.connect")));
  expect(state.complete).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { instanceId, flowId, callbackUrl },
  });
  await switchLanguage("en");
  expect(state.complete).toHaveBeenCalledOnce();
  expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe(
    callbackUrl,
  );
  await act(async () => finish(AsyncResult.success(undefined)));
  expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
  expect(state.start).not.toHaveBeenCalled();
});
