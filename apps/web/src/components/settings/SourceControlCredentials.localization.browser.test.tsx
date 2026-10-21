import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../../test/render";
import { type ReactNode } from "react";

import { expect, it, vi } from "vite-plus/test";
import * as Option from "effect/Option";
import {
  EnvironmentId,
  type SourceControlProviderAuth,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

const state = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  save: vi.fn(),
  onSaved: vi.fn(),
}));
vi.mock("../../hooks/useSettings", async (original) => ({
  ...(await original<typeof import("../../hooks/useSettings")>()),
  useEnvironmentSettings: (
    _environmentId: unknown,
    selector: (settings: UnifiedSettings) => unknown,
  ) => selector(state.settings!),
}));
vi.mock("../../state/server", async (original) => ({
  ...(await original<typeof import("../../state/server")>()),
  serverEnvironment: { updateSettings: {} },
}));
vi.mock("../../state/use-atom-command", async (original) => ({
  ...(await original<typeof import("../../state/use-atom-command")>()),
  useAtomCommand: () => state.save,
}));

vi.mock("./settingsLayout", async (original) => ({
  ...(await original<typeof import("./settingsLayout")>()),
  SettingsRow: ({
    title,
    description,
    control,
    children,
  }: {
    title: ReactNode;
    description: ReactNode;
    control: ReactNode;
    children: ReactNode;
  }) => (
    <section>
      {title}
      {description}
      {control}
      {children}
    </section>
  ),
}));
import { changeLanguage } from "../../i18n";
import { GitHubTokenSettings } from "./GitHubTokenSettings";
import { GitHubAccountSettings } from "./GitHubAccountSettings";
import { SourceControlHostSettings } from "./SourceControlHostSettings";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { SourceControlProviderKind } from "@t3tools/contracts";
const bitbucketHost = sourceControlClients.get(SourceControlProviderKind.make("bitbucket"));
const bitbucket = { ...bitbucketHost, settings: bitbucketHost.settings! };

const environmentId = EnvironmentId.make("controlled-source-host");
let root: Screen;
let container: HTMLDivElement;

const switchLanguage = async (language: "en" | "zh") =>
  await act(async () => changeLanguage(language));
const type = async (id: string, value: string) =>
  await act(async () => {
    const input = document.getElementById(id) as HTMLInputElement;
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === label,
  )!;
const submit = async () =>
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );

it("keeps GitHub host and token drafts across languages and does not repeat a pending save", async () => {
  await using _lifecycle = await setupLifecycle();

  let settle!: (value: { _tag: "Success"; value: undefined }) => void;
  state.save.mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  await act(async () =>
    root.rerender(<GitHubTokenSettings environmentId={environmentId} onSaved={state.onSaved} />),
  );
  await type(`github-token-host-${environmentId}`, "GHE.Example.test");
  await type(`github-token-${environmentId}`, "Controlled-Raw-Token");
  await switchLanguage("zh");
  expect((document.getElementById(`github-token-${environmentId}`) as HTMLInputElement).value).toBe(
    "Controlled-Raw-Token",
  );
  expect(container.textContent).toContain("此处保存的令牌优先于 GH_TOKEN 和 gh 登录账户");
  expect(state.save).not.toHaveBeenCalled();
  await submit();
  expect(state.save).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: {
      patch: {
        sourceControlHosts: { github: { tokens: { "ghe.example.test": "Controlled-Raw-Token" } } },
      },
    },
  });
  await switchLanguage("en");
  expect(container.querySelector("fieldset")!.disabled).toBe(true);
  expect(
    (document.getElementById(`github-token-host-${environmentId}`) as HTMLInputElement).value,
  ).toBe("GHE.Example.test");
  expect((document.getElementById(`github-token-${environmentId}`) as HTMLInputElement).value).toBe(
    "Controlled-Raw-Token",
  );
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(state.onSaved).not.toHaveBeenCalled();
  await act(async () => settle({ _tag: "Success", value: undefined }));
  expect((document.getElementById(`github-token-${environmentId}`) as HTMLInputElement).value).toBe(
    "",
  );
  expect(state.onSaved).toHaveBeenCalledTimes(1);
});

it("keeps a Bitbucket credential draft across language changes and saves the native field", async () => {
  await using _lifecycle = await setupLifecycle();

  await act(async () =>
    root.rerender(
      <SourceControlHostSettings
        environmentId={environmentId}
        definition={bitbucket}
        onSaved={state.onSaved}
      />,
    ),
  );
  const id = `source-control-bitbucket-${environmentId}-apiToken`;
  await type(id, "Controlled-API-Token");
  await switchLanguage("zh");
  expect((document.getElementById(id) as HTMLInputElement).value).toBe("Controlled-API-Token");
  expect(container.textContent).toContain("Atlassian 账户邮箱");
  expect(state.save).not.toHaveBeenCalled();
  await act(async () =>
    document
      .getElementById(id)!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(state.save).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { patch: { sourceControlHosts: { bitbucket: { apiToken: "Controlled-API-Token" } } } },
  });
});

it("keeps account visibility and raw diagnostics while Chinese account choices save raw logins", async () => {
  await using _lifecycle = await setupLifecycle();

  const auth: SourceControlProviderAuth = {
    status: "authenticated",
    account: Option.some("Raw-Personal"),
    host: Option.some("github.com"),
    detail: Option.none(),
    accounts: [
      { host: "github.com", account: "Raw-Personal", active: true, authenticated: true },
      { host: "github.com", account: "Raw-Work", active: false, authenticated: true },
      {
        host: "github.com",
        account: "Raw-Broken",
        active: false,
        authenticated: false,
        error: "raw gh error: account expired",
      },
      {
        host: "github.com",
        account: "Raw-Bot",
        active: false,
        authenticated: true,
        environmentVariable: "GH_TOKEN",
      },
    ],
  };
  await act(async () =>
    root.rerender(
      <GitHubAccountSettings environmentId={environmentId} auth={auth} onSaved={state.onSaved} />,
    ),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Reveal GitHub accounts"]')!
      .click(),
  );
  await switchLanguage("zh");
  expect(container.querySelector('button[aria-label="隐藏 GitHub 账户"]')).not.toBeNull();
  expect(container.textContent).toContain("Raw-Personal");
  expect(container.textContent).toContain("无法使用：raw gh error: account expired");
  expect(container.textContent).toContain("服务器已设置 GH_TOKEN");
  expect(state.save).not.toHaveBeenCalled();
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="github.com 的 GitHub 账户"]',
  )!;
  await act(async () => trigger.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (node) => node.textContent?.trim() === "Raw-Work",
  )!;
  await act(async () => option.click());
  expect(state.save).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: {
      patch: {
        sourceControlHosts: {
          github: { hosts: { "github.com": { enabled: true, account: "Raw-Work" } } },
        },
      },
    },
  });
  expect(state.onSaved).toHaveBeenCalledTimes(1);
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    await changeLanguage("en");
    vi.unstubAllGlobals();
  });

  await changeLanguage("en");
  state.settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    sourceControlHosts: {
      github: { hosts: {}, tokens: {} },
      bitbucket: { accessToken: "", email: "", apiToken: "" },
    },
  };
  state.save.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  state.onSaved.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));

  renderStack = stack.move();
  return renderStack;
}
