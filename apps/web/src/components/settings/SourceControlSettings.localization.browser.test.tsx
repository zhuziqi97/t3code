import { SourceControlProviderKind } from "@t3tools/contracts";
import "~/index.css";
import { type ReactNode } from "react";
import { act, render } from "../../../test/render";
import { expect, it, vi } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Duration from "effect/Duration";
import {
  EnvironmentId,
  type SourceControlDiscoveryResult,
  type SourceControlProviderDiscoveryItem,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";

const state = vi.hoisted(() => ({
  settings: null as typeof DEFAULT_UNIFIED_SETTINGS | null,
  discovery: null as SourceControlDiscoveryResult | null,
  error: null as string | null,
  refresh: vi.fn(),
  update: vi.fn(),
}));
vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => {
    const environment = {
      environmentId: EnvironmentId.make("controlled-host"),
      label: "Raw Host Name",
      connection: { phase: "connected" },
    };
    return {
      scope: { kind: "environment", environmentIds: [environment.environmentId] },
      environment,
      connectedEnvironments: [environment],
    };
  },
}));
vi.mock("./useScopedSettings", () => ({
  useScopedSettings: () => state.settings,
  useScopedSettingsMixed: () => false,
  useScopedSettingsWriteAllowed: () => true,
  useUpdateScopedSettings: () => state.update,
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: state.discovery,
    error: state.error,
    isPending: false,
    refresh: state.refresh,
  }),
}));
vi.mock("../../state/sourceControl", () => ({
  sourceControlEnvironment: { discovery: () => "controlled-discovery" },
}));
vi.mock("./ProjectDefaultsSettings", () => ({ ProjectDefaultsSettings: () => null }));
vi.mock("./SourceControlWritingSettings", () => ({
  SourceControlWritingSettingsSection: () => null,
}));
vi.mock("./SourceControlTokenSettings", () => ({ SourceControlTokenSettings: () => null }));
vi.mock("./SourceControlAccountSettings", () => ({ SourceControlAccountSettings: () => null }));
vi.mock("./SourceControlHostSettings", () => ({ SourceControlHostSettings: () => null }));
vi.mock("./settingsLayout", () => ({
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
      <h3>{title}</h3>
      {description}
      {control}
      {children}
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
      <h3>{title}</h3>
      {headerAction}
      {children}
    </section>
  ),
  SettingsPageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  SettingsSearchTarget: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PolicyTooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  SettingResetButton: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button onClick={onClick}>{label}</button>
  ),
  useSettingsSearchTargetId: () => null,
}));

import { changeLanguage } from "../../i18n";
import { SourceControlSettingsPanel } from "./SourceControlSettings";
import { BackgroundActivitySettingsRow } from "./BackgroundActivitySettings";

async function setup() {
  await changeLanguage("en");
  state.settings = DEFAULT_UNIFIED_SETTINGS;
  state.discovery = { versionControlSystems: [], sourceControlProviders: [] };
  state.error = null;
  state.refresh.mockReset();
  state.update.mockReset();
  return {
    async [Symbol.asyncDispose]() {
      await changeLanguage("en");
    },
  };
}
const switchLanguage = async () => act(async () => changeLanguage("zh"));
function provider(
  kind: SourceControlProviderDiscoveryItem["kind"],
  label: string,
  overrides: Partial<SourceControlProviderDiscoveryItem> = {},
): SourceControlProviderDiscoveryItem {
  return {
    kind,
    label,
    status: "available",
    version: Option.some("Raw-Version-1"),
    installHint: "Raw install hint",
    detail: Option.none(),
    auth: { status: "unknown", account: Option.none(), host: Option.none(), detail: Option.none() },
    ...overrides,
  };
}

it("keeps a failed scan diagnostic and only scans when the translated action is clicked", async () => {
  await using _setup = await setup();
  state.error = "raw discovery failure: EACCES";
  await using screen = await render(<SourceControlSettingsPanel />);
  const container = screen.container;
  await switchLanguage();
  expect(container.textContent).toContain("无法扫描服务器环境");
  expect(container.textContent).toContain("raw discovery failure: EACCES");
  expect(state.refresh).not.toHaveBeenCalled();
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === "扫描",
  )!;
  await act(async () => button.click());
  expect(state.refresh).toHaveBeenCalledTimes(1);
});

it("localizes discovered states and installation instructions while preserving tool names, versions and commands", async () => {
  await using _setup = await setup();
  const gitlab = provider(SourceControlProviderKind.make("gitlab"), "Raw GitLab Host", {
    executable: "glab",
  });
  state.discovery = {
    versionControlSystems: [
      {
        kind: "jj",
        label: "Jujutsu",
        implemented: false,
        status: "available",
        executable: "jj",
        version: Option.some("Raw-JJ-Version"),
        installHint: "Install Jujutsu with `brew install jj` or from https://github.com/jj-vcs/jj.",
        detail: Option.none(),
      },
    ],
    sourceControlProviders: [
      provider(SourceControlProviderKind.make("github"), "GitHub", {
        executable: "gh",
        status: "missing",
        installHint:
          "Install the GitHub command-line tool (`gh`) via https://cli.github.com/ or your package manager (for example `brew install gh`).",
      }),
      { ...gitlab, auth: { ...gitlab.auth, status: "unauthenticated" } },
      provider(SourceControlProviderKind.make("bitbucket"), "Bitbucket", {
        auth: { ...gitlab.auth, status: "unauthenticated" },
      }),
    ],
  };
  await using screen = await render(<SourceControlSettingsPanel />);
  const container = screen.container;
  await switchLanguage();
  expect(container.textContent).toContain("即将支持 Jujutsu。");
  expect(container.textContent).toContain("Raw-JJ-Version");
  expect(container.textContent).toContain("此服务器尚不可用：通过 https://cli.github.com/");
  expect(container.textContent).toContain("brew install gh");
  expect(container.textContent).toContain("此服务器上的 Raw GitLab Host 尚未认证。");
  expect([...container.querySelectorAll("code")].map((node) => node.textContent)).toContain("glab");
  expect(container.textContent).toContain("可用。在“设置 → 版本控制”中添加 Bitbucket 令牌。");
  expect(state.refresh).not.toHaveBeenCalled();
});

it("keeps a revealed account across languages and translates owned details while retaining raw failures", async () => {
  await using _setup = await setup();
  const github = provider(SourceControlProviderKind.make("github"), "GitHub");
  state.discovery = {
    versionControlSystems: [],
    sourceControlProviders: [
      {
        ...github,
        auth: {
          ...github.auth,
          status: "authenticated",
          account: Option.some("Raw-GitHub-Account"),
          detail: Option.some(
            "Using GH_ENTERPRISE_TOKEN from the server environment; it overrides the account chosen in Settings.",
          ),
        },
      },
    ],
  };
  await using screen = await render(<SourceControlSettingsPanel />);
  const container = screen.container;
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Toggle source control account visibility"]',
      )!
      .click(),
  );
  await switchLanguage();
  expect(container.textContent).toContain("已认证账户：");
  expect(
    container.querySelector('button[aria-label="切换版本控制账户显示状态"]')?.textContent,
  ).toBe("Raw-GitHub-Account");
  expect(container.textContent).toContain(
    "正在使用服务器环境中的 GH_ENTERPRISE_TOKEN；它会覆盖设置中选择的账户。",
  );
  state.discovery = {
    versionControlSystems: [],
    sourceControlProviders: [
      {
        ...github,
        auth: {
          ...github.auth,
          detail: Option.some(
            "Could not check the token in GH_TOKEN: raw HTTP 503\nupstream unavailable",
          ),
        },
      },
    ],
  };
  await screen.rerender(<SourceControlSettingsPanel />);
  expect(container.textContent).toContain(
    "无法检查 GH_TOKEN 中的令牌：raw HTTP 503\nupstream unavailable",
  );
  state.discovery = {
    versionControlSystems: [],
    sourceControlProviders: [
      {
        ...github,
        auth: {
          ...github.auth,
          detail: Option.some(
            "GitHub CLI is too old to report sign-in status. Update `gh` to 2.81.0 or newer (for example `brew upgrade gh`) and rescan.",
          ),
        },
      },
    ],
  };
  await screen.rerender(<SourceControlSettingsPanel />);
  expect(container.textContent).toContain("GitHub CLI 版本过旧，无法报告登录状态。");
  expect(container.textContent).toContain("brew upgrade gh");
  state.discovery = {
    versionControlSystems: [],
    sourceControlProviders: [
      { ...github, auth: { ...github.auth, detail: Option.some("raw gh diagnostic: denied") } },
    ],
  };
  await screen.rerender(<SourceControlSettingsPanel />);
  expect(container.textContent).toContain("无法验证 GitHub。raw gh diagnostic: denied");
  expect(state.refresh).not.toHaveBeenCalled();
});

it("keeps provider details open across languages and submits seconds through background activity settings", async () => {
  await using _setup = await setup();
  state.discovery = {
    versionControlSystems: [
      {
        kind: "git",
        label: "Git",
        implemented: true,
        status: "available",
        executable: "git",
        version: Option.some("Raw-Git-Version"),
        installHint: "Install Git from https://git-scm.com/downloads or with your package manager.",
        detail: Option.none(),
      },
    ],
    sourceControlProviders: [provider(SourceControlProviderKind.make("github"), "GitHub")],
  };
  state.settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    backgroundActivity: {
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "balanced",
      overrides: { automaticGitFetchInterval: Duration.seconds(35) },
    },
  };
  await using screen = await render(
    <>
      <SourceControlSettingsPanel />
      <BackgroundActivitySettingsRow />
    </>,
  );
  const container = screen.container;
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Toggle GitHub details"]')!
      .click(),
  );
  await screen.getByRole("button", { name: "Configure advanced background activity" }).click();
  await switchLanguage();
  expect(
    container
      .querySelector('button[aria-label="展开或收起 GitHub 详情"]')
      ?.getAttribute("aria-expanded"),
  ).toBe("true");
  const initial = Math.round(
    Duration.toMillis(
      resolveServerBackgroundActivitySettings(state.settings).automaticGitFetchInterval,
    ) / 1000,
  );
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="自动获取 Git 更新的间隔（秒）"]')!
      .value,
  ).toBe(String(initial));
  expect(state.update).not.toHaveBeenCalled();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button[aria-label="延长获取间隔"]')!.click(),
  );
  expect(state.update).toHaveBeenCalledTimes(1);
  const patch = state.update.mock.calls[0]![0];
  expect(Duration.toMillis(patch.backgroundActivity.overrides.automaticGitFetchInterval)).toBe(
    (initial + 5) * 1000,
  );
  expect(patch.backgroundActivity).toMatchObject({ schemaVersion: 1, profile: "custom" });
  expect(state.refresh).not.toHaveBeenCalled();
});
