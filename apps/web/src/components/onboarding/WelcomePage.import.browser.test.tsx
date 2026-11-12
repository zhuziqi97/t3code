import { RegistryContext } from "@effect/atom-react";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthProvidersManageScope,
  AuthTerminalOperateScope,
  AuthRelayReadScope,
  AuthRelayWriteScope,
  EnvironmentId,
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type AgentSessionProjectCandidate,
  type AuthEnvironmentScope,
  type AuthSessionState,
  type EnvironmentCloudLinkStateResult,
  type ServerProvider,
  type ServerProviderInstallation,
  type ProviderAuthState,
  type ProviderInstallState,
  type ServerConfig,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { act, render } from "../../../test/render";

type SessionResult = AsyncResult.AsyncResult<AuthSessionState, Error>;
type Project = { id: ProjectId; environmentId: EnvironmentId; workspaceRoot: string };
type CreateProjectInput = {
  environmentId: EnvironmentId;
  input: { projectId: ProjectId; workspaceRoot: string };
};
const state = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
  projects: null as unknown,
  providers: null as unknown,
  config: null as unknown,
  settings: null as unknown,
  candidates: null as unknown,
  createProject: vi.fn(),
  importThreads: vi.fn(),
  refreshProviders: vi.fn(),
  discoverInstallations: vi.fn(),
  openTerminal: vi.fn(),
  writeTerminal: vi.fn(),
  closeTerminal: vi.fn(),
  updateSettings: vi.fn(),
  startInstall: vi.fn(),
  signIn: vi.fn(),
  authQuery: null as unknown,
  installationQuery: null as unknown,
  completeOnboarding: vi.fn(),
  onDone: vi.fn(),
  scan: vi.fn(),
  refreshScan: vi.fn(),
  waitForProject: vi.fn(),
  cloud: false,
  auth: { isLoaded: true, isSignedIn: false, userId: null as string | null },
  linkState: null as unknown,
  linkError: null as string | null,
  refreshLinkState: vi.fn(),
  scanError: null as string | null,
  scanPending: false,
}));

vi.mock(import("@t3tools/client-runtime/state/session"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    createEnvironmentSessionAtoms: ((runtime: never) => ({
      ...actual.createEnvironmentSessionAtoms(runtime),
      sessionStateAtom: (id: EnvironmentId) => state.sessions.get(id),
    })) as never,
  };
});
vi.mock(import("../../cloud/publicConfig"), async (original) => ({
  ...(await original()),
  hasCloudPublicConfig: () => state.cloud,
}));
vi.mock(import("@clerk/react"), async (original) => ({
  ...(await original()),
  useAuth: (() => state.auth) as never,
}));
vi.mock(import("../clerk/useT3ConnectAuthPrompt"), async (original) => ({
  ...(await original()),
  useT3ConnectAuthPrompt: (() => ({ openAuthPrompt: () => {} })) as never,
}));
vi.mock(import("../../cloud/cloudLinkState"), async (original) => {
  const { useAtomValue } = await import("@effect/atom-react");
  return {
    ...(await original()),
    useCloudLinkState: (() => ({
      data: useAtomValue(state.linkState as Atom.Atom<EnvironmentCloudLinkStateResult | null>),
      error: state.linkError,
      isPending: false,
      refresh: state.refreshLinkState,
    })) as never,
  };
});
vi.mock(import("../../onboarding/firstRun"), async (original) => ({
  ...(await original()),
  completeOnboarding: state.completeOnboarding,
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({
    environments: [{ environmentId: "primary", label: "primary" }],
  })) as never,
  usePrimaryEnvironmentId: (() => "primary") as never,
}));
vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      providersValueAtom: (() => state.providers) as never,
      configValueAtom: (() => state.config) as never,
      settingsValueAtom: (() => state.settings) as never,
      refreshProviders: "refreshProviders" as never,
      providerAuthState: (() => state.authQuery) as never,
      providerInstallState: (() => state.installationQuery) as never,
    },
  };
});
vi.mock(import("../../state/entities"), async (original) => {
  const { useAtomValue } = await import("@effect/atom-react");
  return {
    ...(await original()),
    useProjects: (() => useAtomValue(state.projects as Atom.Atom<Project[]>)) as never,
    readProjects: (() => appAtomRegistry.get(state.projects as Atom.Atom<Project[]>)) as never,
    waitForProject: ((ref: unknown) => state.waitForProject(ref)) as never,
  };
});
vi.mock(import("../../state/projects"), async (original) => ({
  ...(await original()),
  projectEnvironment: { create: "createProject" } as never,
}));
vi.mock(import("../../state/terminal"), async (original) => ({
  ...(await original()),
  terminalEnvironment: {
    open: "openTerminal",
    write: "writeTerminal",
    close: "closeTerminal",
  } as never,
}));
vi.mock(import("../ThreadTerminalDrawer"), () => ({ TerminalViewport: () => <></> }));
vi.mock(import("../../state/agentSessions"), async (original) => ({
  ...(await original()),
  agentSessionImport: "importThreads" as never,
}));
vi.mock(import("../../onboarding/useProjectScans"), async (original) => {
  const { useAtomValue } = await import("@effect/atom-react");
  return {
    ...(await original()),
    useProjectScans: (ids: readonly EnvironmentId[]) => {
      const candidates = useAtomValue(
        state.candidates as Atom.Atom<AgentSessionProjectCandidate[]>,
      );
      return ids.map((environmentId) => {
        state.scan({ environmentId });
        return {
          environmentId,
          data: (state.scanPending ? null : { candidates, truncated: false }) as never,
          isPending: state.scanPending,
          error: state.scanError,
          refresh: state.refreshScan,
        };
      });
    },
  };
});
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((
    command:
      | "createProject"
      | "importThreads"
      | "refreshProviders"
      | "openTerminal"
      | "writeTerminal"
      | "closeTerminal"
      | { label: string },
  ) =>
    typeof command === "string"
      ? state[command]
      : command.label === "environment-data:server:discover-provider-installations"
        ? state.discoverInstallations
        : command.label === "environment-data:server:update-settings"
          ? state.updateSettings
          : command.label === "environment-data:provider:install-start"
            ? state.startInstall
            : command.label === "environment-data:provider:auth-start" ||
                command.label === "environment-data:chatgpt:reconnect-profile"
              ? state.signIn
              : undefined) as never,
}));

import { welcomeImportSelectionKey } from "../../onboarding/welcomeState";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { toastManager } from "../ui/toast";
import { WelcomePage } from "./WelcomePage";

const primaryId = EnvironmentId.make("primary");
const readyClaude: ServerProvider = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-01-01T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};
const permissionMessage = "This connection cannot import projects or thread history.";

function session(scopes: ReadonlyArray<AuthEnvironmentScope>): AuthSessionState {
  return {
    authenticated: true,
    scopes: [AuthOrchestrationReadScope, ...scopes],
    auth: {
      policy: "remote-reachable",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["bearer-access-token"],
      sessionCookieName: "t3_session",
    },
  };
}

function sessionAtom(environmentId: EnvironmentId) {
  return state.sessions.get(environmentId) as Atom.Writable<SessionResult>;
}

function projectsAtom() {
  return state.projects as Atom.Writable<ReadonlyArray<Project>>;
}

function candidatesAtom() {
  return state.candidates as Atom.Writable<ReadonlyArray<AgentSessionProjectCandidate>>;
}

function setGrant(environmentId: EnvironmentId, allowed: boolean) {
  appAtomRegistry.set(
    sessionAtom(environmentId),
    AsyncResult.success(session(allowed ? [AuthOrchestrationOperateScope] : [])),
  );
}

// Default selection only picks recently active projects, so pin "now".
const NOW = Date.parse("2026-01-01T00:00:00.000Z");

function candidate(
  path: string,
  overrides: Partial<AgentSessionProjectCandidate> = {},
): AgentSessionProjectCandidate {
  return {
    path,
    title: path.split("/").at(-1)!,
    sources: ["codex"],
    threadCount: 10,
    lastActiveAt: new Date(NOW - 60_000).toISOString(),
    alreadyImported: false,
    ...overrides,
  };
}

function recordProject({ environmentId, input }: CreateProjectInput) {
  appAtomRegistry.set(projectsAtom(), [
    ...appAtomRegistry.get(projectsAtom()),
    { id: input.projectId, environmentId, workspaceRoot: input.workspaceRoot },
  ]);
  return AsyncResult.success(undefined);
}

// Resolves once the project reaches the mocked projects atom; the real helper's timeout is
// replaced per test with a rejection.
function waitForRecordedProject(ref: { environmentId: EnvironmentId; projectId: string }) {
  const find = () =>
    appAtomRegistry
      .get(projectsAtom())
      .find(
        (project) => project.id === ref.projectId && project.environmentId === ref.environmentId,
      );
  return new Promise<Project>((resolve) => {
    const current = find();
    if (current) return resolve(current);
    const unsubscribe = appAtomRegistry.subscribe(projectsAtom(), () => {
      const project = find();
      if (!project) return;
      unsubscribe();
      resolve(project);
    });
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function pageText() {
  return document.body.textContent ?? "";
}

function button(label: string) {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

async function click(label: string) {
  const target = button(label);
  expect(target.disabled).toBe(false);
  await act(async () => target.click());
}

async function mountWelcome() {
  return render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <WelcomePage environmentId={primaryId} onDone={state.onDone} />
    </RegistryContext.Provider>,
  );
}

// The mocked modules read `state`, so every test starts by replacing all of it.
// Returns the clock spy so each test can `using` it; the spy would otherwise outlive the test.
function setup({ importOptedIn = false } = {}) {
  const now = vi.spyOn(Date, "now").mockReturnValue(NOW);
  state.sessions.clear();
  for (const id of [primaryId]) {
    state.sessions.set(
      id,
      Atom.make<SessionResult>(AsyncResult.success(session([AuthOrchestrationOperateScope]))).pipe(
        Atom.keepAlive,
      ),
    );
  }
  state.projects = Atom.make<ReadonlyArray<Project>>([]).pipe(Atom.keepAlive);
  state.providers = Atom.make<ReadonlyArray<ServerProvider>>([readyClaude]).pipe(Atom.keepAlive);
  state.config = Atom.make(null).pipe(Atom.keepAlive);
  state.settings = Atom.make(DEFAULT_SERVER_SETTINGS).pipe(Atom.keepAlive);
  state.candidates = Atom.make<ReadonlyArray<AgentSessionProjectCandidate>>([
    candidate("/projects/first"),
    candidate("/projects/second"),
  ]).pipe(Atom.keepAlive);
  state.createProject
    .mockReset()
    .mockImplementation(async (input: CreateProjectInput) => recordProject(input));
  state.importThreads
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ importedCount: 1, skippedCount: 0 }));
  state.refreshProviders.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.discoverInstallations
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ installations: [] }));
  state.openTerminal.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.writeTerminal.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.closeTerminal.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.updateSettings.mockReset();
  state.startInstall.mockReset();
  state.signIn
    .mockReset()
    .mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("controlled sign-in held"))));
  state.authQuery = Atom.make(
    AsyncResult.success<ProviderAuthState>({
      instanceId: ProviderInstanceId.make("codex"),
      phase: "idle",
      flowId: null,
      authorizationUrl: null,
      expiresAt: null,
      message: null,
    }),
  ).pipe(Atom.keepAlive);
  state.installationQuery = Atom.make(
    AsyncResult.success<ProviderInstallState>({
      driver: ProviderDriverKind.make("codex"),
      operationId: null,
      phase: "idle",
      downloadedBytes: 0,
      totalBytes: null,
      version: "fixture-1",
      installedVersion: null,
      source: "managed",
      canRemove: false,
      message: null,
    }),
  ).pipe(Atom.keepAlive);
  state.completeOnboarding.mockReset().mockResolvedValue(undefined);
  state.onDone.mockReset();
  state.scan.mockReset();
  state.refreshScan.mockReset();
  state.waitForProject.mockReset().mockImplementation(waitForRecordedProject);
  state.cloud = false;
  state.auth = { isLoaded: true, isSignedIn: false, userId: null };
  state.linkState = Atom.make<EnvironmentCloudLinkStateResult | null>(null).pipe(Atom.keepAlive);
  state.linkError = null;
  state.refreshLinkState.mockReset();
  state.scanError = null;
  state.scanPending = false;
  if (importOptedIn) {
    localStorage.setItem(
      welcomeImportSelectionKey(primaryId),
      JSON.stringify({ knownKeys: [], keys: [], optedOut: false }),
    );
  } else {
    localStorage.removeItem(welcomeImportSelectionKey(primaryId));
  }
  return now;
}

it("rechecks after project creation and can retry its history without recreating the project", async () => {
  using _now = setup({ importOptedIn: true });
  const creation = deferred<void>();
  state.createProject.mockImplementationOnce(async (input: CreateProjectInput) => {
    await creation.promise;
    return recordProject(input);
  });
  await using _screen = await mountWelcome();
  await click("Import 2 projects and start");
  expect(state.createProject).toHaveBeenCalledOnce();
  await act(async () => {
    setGrant(primaryId, false);
    creation.resolve();
    await creation.promise;
  });
  expect(state.importThreads).not.toHaveBeenCalled();
  expect(state.createProject).toHaveBeenCalledOnce();
  expect(state.onDone).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(pageText()).toContain(permissionMessage));

  await act(async () => setGrant(primaryId, true));
  // The first project now exists, so only the second counts as new.
  await click("Import 1 project and start");
  expect(state.createProject).toHaveBeenCalledTimes(2);
  expect(state.importThreads).toHaveBeenCalledTimes(2);
  expect(state.onDone).toHaveBeenCalledOnce();
});

it("completes accepted imports when permission is revoked after the final server write", async () => {
  using _now = setup({ importOptedIn: true });
  appAtomRegistry.set(candidatesAtom(), [candidate("/projects/first")]);
  const imported = deferred<{ importedCount: number; skippedCount: number }>();
  state.importThreads.mockImplementationOnce(async () =>
    AsyncResult.success(await imported.promise),
  );
  await using _screen = await mountWelcome();
  await click("Import 1 project and start");
  await act(async () => {
    setGrant(primaryId, false);
    imported.resolve({ importedCount: 1, skippedCount: 0 });
    await imported.promise;
  });
  expect(state.createProject).toHaveBeenCalledOnce();
  expect(state.importThreads).toHaveBeenCalledOnce();
  expect(state.completeOnboarding).toHaveBeenCalledOnce();
  expect(state.onDone).toHaveBeenCalledOnce();
});

it("finishes setup without landing when the imported project never reaches the client", async () => {
  using _now = setup({ importOptedIn: true });
  appAtomRegistry.set(candidatesAtom(), [candidate("/projects/first")]);
  // The server accepts the project, but it never shows up in the client's projects.
  state.createProject.mockResolvedValue(AsyncResult.success(undefined));
  state.waitForProject.mockRejectedValue(new Error("The project did not appear."));
  state.completeOnboarding.mockRejectedValueOnce(new Error("offline"));
  await using _screen = await mountWelcome();
  using toastAdd = vi.spyOn(toastManager, "add");

  await click("Import 1 project and start");
  await vi.waitFor(() => expect(state.completeOnboarding).toHaveBeenCalledOnce());
  // A failed completion hands the step back instead of leaving it importing.
  await vi.waitFor(() => expect(button("Import 1 project and start").disabled).toBe(false));
  expect(state.onDone).not.toHaveBeenCalled();

  await click("Import 1 project and start");
  await vi.waitFor(() => expect(state.onDone).toHaveBeenCalledOnce());
  expect(state.onDone).toHaveBeenCalledWith(undefined);
  // The retry skips the project it already imported, but still counts its thread.
  await vi.waitFor(() =>
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success", title: "Imported 1 thread" }),
    ),
  );
});

it("waits for a ready agent to start, and Start without an agent still finishes setup", async () => {
  using _now = setup();
  localStorage.setItem(
    welcomeImportSelectionKey(primaryId),
    JSON.stringify({ knownKeys: [], keys: [], optedOut: false }),
  );
  state.discoverInstallations.mockResolvedValueOnce(
    AsyncResult.failure(Cause.fail(new Error("controlled discovery failure"))),
  );
  appAtomRegistry.set(state.providers as Atom.Writable<ReadonlyArray<ServerProvider>>, []);
  await using _screen = await mountWelcome();
  expect(button("Import 2 projects and start").disabled).toBe(true);
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Could not check installed agents."),
  );
  expect(
    document.querySelector<HTMLAnchorElement>('a[href^="/settings/providers"]')!.href,
  ).toContain("environmentId=primary");

  await click("Start without an agent");
  await vi.waitFor(() => expect(state.onDone).toHaveBeenCalledOnce());
  expect(state.createProject).toHaveBeenCalledTimes(2);
});

it("keeps installation facts scoped when switching computers without enabling an agent", async () => {
  using _now = setup();
  const other = EnvironmentId.make("other-computer");
  state.sessions.set(
    other,
    Atom.make<SessionResult>(AsyncResult.success(session([]))).pipe(Atom.keepAlive),
  );
  appAtomRegistry.set(candidatesAtom(), []);
  const pi = {
    ...readyClaude,
    instanceId: ProviderInstanceId.make("pi"),
    driver: ProviderDriverKind.make("pi"),
    enabled: false,
    installed: false,
    status: "disabled" as const,
  };
  appAtomRegistry.set(state.providers as Atom.Writable<ReadonlyArray<ServerProvider>>, [pi]);
  const installation: ServerProviderInstallation = {
    instanceId: pi.instanceId,
    driver: pi.driver,
    installed: true,
    version: "7.5.0",
  };
  type Discovery = {
    _tag: "Success";
    value: { installations: readonly ServerProviderInstallation[] };
  };
  const first = deferred<Discovery>();
  const second = deferred<Discovery>();
  state.discoverInstallations
    .mockReset()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockResolvedValueOnce(AsyncResult.success({ installations: [installation] }));
  await using screen = await mountWelcome();
  await vi.waitFor(() => expect(state.discoverInstallations).toHaveBeenCalledTimes(1));
  await screen.rerender(
    <RegistryContext.Provider value={appAtomRegistry}>
      <WelcomePage environmentId={other} onDone={state.onDone} />
    </RegistryContext.Provider>,
  );
  await vi.waitFor(() => expect(state.discoverInstallations).toHaveBeenCalledTimes(2));
  await act(async () =>
    second.resolve(AsyncResult.success({ installations: [{ ...installation, installed: false }] })),
  );
  await expect.element(screen.getByText("Not installed", { exact: true })).toBeVisible();
  await act(async () => first.resolve(AsyncResult.success({ installations: [installation] })));
  await expect.element(screen.getByText("Not installed", { exact: true })).toBeVisible();
  await expect
    .element(screen.getByText("Installed · 7.5.0", { exact: true }))
    .not.toBeInTheDocument();
  await screen.rerender(
    <RegistryContext.Provider value={appAtomRegistry}>
      <WelcomePage environmentId={primaryId} onDone={state.onDone} />
    </RegistryContext.Provider>,
  );
  await expect.element(screen.getByText("Installed · 7.5.0", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("Disabled", { exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Start without an agent" }))
    .toBeEnabled();
  expect(state.discoverInstallations.mock.calls.map(([input]) => input)).toEqual([
    { environmentId: primaryId, input: {} },
    { environmentId: other, input: {} },
    { environmentId: primaryId, input: {} },
  ]);
  expect(state.refreshProviders).toHaveBeenCalledTimes(3);
  expect(state.createProject).not.toHaveBeenCalled();
  expect(state.importThreads).not.toHaveBeenCalled();
});

function allowAgentSetup() {
  appAtomRegistry.set(
    sessionAtom(primaryId),
    AsyncResult.success(session([AuthProvidersManageScope, AuthTerminalOperateScope])),
  );
  const config = {
    settings: DEFAULT_SERVER_SETTINGS,
    cwd: "/controlled-project",
    keybindings: {},
    environment: { platform: { os: "linux" } },
  } as ServerConfig;
  appAtomRegistry.set(state.config as Atom.Writable<ServerConfig | null>, config);
  appAtomRegistry.set(candidatesAtom(), []);
  return config;
}

it("refreshes after CLI setup and ignores an older installation result on the same computer", async () => {
  using _now = setup();
  allowAgentSetup();
  const cli = {
    ...readyClaude,
    installed: false,
    status: "error" as const,
    auth: { status: "unknown" as const },
  };
  appAtomRegistry.set(state.providers as Atom.Writable<ReadonlyArray<ServerProvider>>, [cli]);
  const installation = {
    instanceId: cli.instanceId,
    driver: cli.driver,
    installed: false,
    version: null,
  };
  const old = deferred<{
    _tag: "Success";
    value: { installations: readonly ServerProviderInstallation[] };
  }>();
  state.discoverInstallations
    .mockReset()
    .mockResolvedValueOnce(AsyncResult.success({ installations: [installation] }))
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue(
      AsyncResult.success({
        installations: [{ ...installation, installed: true, version: "fixture-cli" }],
      }),
    );
  await using screen = await mountWelcome();
  await expect.element(screen.getByText("Not installed", { exact: true })).toBeVisible();
  await act(async () =>
    appAtomRegistry.set(state.providers as Atom.Writable<ReadonlyArray<ServerProvider>>, [
      { ...cli, checkedAt: "2026-01-01T00:01:00.000Z" },
    ]),
  );
  await expect.element(screen.getByText("Not installed", { exact: true })).toBeVisible();
  await click("Browse");
  await click("Cancel");
  await expect.element(screen.getByText("Checking installation…", { exact: true })).toBeVisible();
  await click("Install");
  await expect
    .element(screen.getByText("Review the command, then press Enter to run it.", { exact: true }))
    .toBeVisible();
  await click("Close");
  await expect.element(screen.getByText("Installed · fixture-cli", { exact: true })).toBeVisible();
  await act(async () => old.resolve(AsyncResult.success({ installations: [installation] })));
  await expect.element(screen.getByText("Installed · fixture-cli", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("Ready", { exact: true })).not.toBeInTheDocument();
});

it("discovers a newly added account and its managed installation before authentication succeeds", async () => {
  using _now = setup();
  const config = allowAgentSetup();
  appAtomRegistry.set(state.providers as Atom.Writable<ReadonlyArray<ServerProvider>>, []);
  let facts: readonly ServerProviderInstallation[] = [];
  state.discoverInstallations.mockImplementation(async () =>
    AsyncResult.success({ installations: facts }),
  );
  state.updateSettings.mockImplementation(
    async ({
      input,
    }: {
      input: { patch: { providerInstances: ServerConfig["settings"]["providerInstances"] } };
    }) => {
      const [id, entry] = Object.entries(input.patch.providerInstances).find(([key]) =>
        key.startsWith("codex_"),
      )!;
      const instanceId = ProviderInstanceId.make(id);
      const provider: ServerProvider = {
        ...readyClaude,
        instanceId,
        driver: ProviderDriverKind.make("codex"),
        displayName: entry.displayName,
        installed: false,
        status: "error",
        auth: { status: "unauthenticated" },
        setup: { canAuthenticate: true, canInstall: false },
      };
      const settings = {
        ...DEFAULT_SERVER_SETTINGS,
        providerInstances: input.patch.providerInstances,
      };
      facts = [{ instanceId, driver: provider.driver, installed: false, version: null }];
      appAtomRegistry.set(
        state.authQuery as Atom.Writable<AsyncResult.AsyncResult<ProviderAuthState>>,
        AsyncResult.success({
          instanceId,
          phase: "idle",
          flowId: null,
          authorizationUrl: null,
          expiresAt: null,
          message: null,
        }),
      );
      appAtomRegistry.set(state.settings as Atom.Writable<typeof settings>, settings);
      appAtomRegistry.set(state.config as Atom.Writable<ServerConfig | null>, {
        ...config,
        settings,
      });
      appAtomRegistry.set(state.providers as Atom.Writable<ReadonlyArray<ServerProvider>>, [
        provider,
      ]);
      return AsyncResult.success(undefined);
    },
  );
  const running: ProviderInstallState = {
    driver: ProviderDriverKind.make("codex"),
    operationId: "welcome-install",
    phase: "downloading",
    downloadedBytes: 0,
    totalBytes: null,
    version: "fixture-1",
    installedVersion: null,
    source: "managed",
    canRemove: false,
    message: null,
  };
  state.startInstall.mockImplementation(async () => {
    appAtomRegistry.set(
      state.installationQuery as Atom.Writable<AsyncResult.AsyncResult<ProviderInstallState>>,
      AsyncResult.success(running),
    );
    return AsyncResult.success(running);
  });
  await using screen = await mountWelcome();
  await click("Browse");
  await click("Continue with ChatGPT");
  await click("Continue");
  await click("Finish later");
  await expect.element(screen.getByText("Not installed", { exact: true })).toBeVisible();
  await act(async () =>
    appAtomRegistry.set(
      state.providers as Atom.Writable<ReadonlyArray<ServerProvider>>,
      appAtomRegistry
        .get(state.providers as Atom.Writable<ReadonlyArray<ServerProvider>>)
        .map((provider) => ({
          ...provider,
          setup: { canAuthenticate: true, canInstall: true },
        })),
    ),
  );
  await click("Set up");
  await click("Continue with ChatGPT");
  await vi.waitFor(() => expect(state.startInstall).toHaveBeenCalledOnce());
  facts = [{ ...facts[0]!, installed: true, version: "fixture-1" }];
  await act(async () =>
    appAtomRegistry.set(
      state.installationQuery as Atom.Writable<AsyncResult.AsyncResult<ProviderInstallState>>,
      AsyncResult.success({ ...running, phase: "succeeded", installedVersion: "fixture-1" }),
    ),
  );
  await expect.element(screen.getByText("Installed · fixture-1", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("Ready", { exact: true })).not.toBeInTheDocument();
  expect(state.createProject).not.toHaveBeenCalled();
  expect(state.importThreads).not.toHaveBeenCalled();
});

it("blocks leaving the page until the imported projects have landed", async () => {
  using _now = setup({ importOptedIn: true });
  const creation = deferred<void>();
  state.createProject.mockImplementationOnce(async (input: CreateProjectInput) => {
    await creation.promise;
    return recordProject(input);
  });
  const landing = deferred<void>();
  state.waitForProject.mockImplementation(
    async (ref: { environmentId: EnvironmentId; projectId: string }) => {
      await landing.promise;
      return waitForRecordedProject(ref);
    },
  );
  await using screen = await mountWelcome();
  await click("Import 2 projects and start");

  // A blocked navigation never settles, so it is not awaited.
  const leave = () =>
    act(async () => {
      void screen.router?.navigate({ to: "/settings" });
    });
  await leave();
  await act(async () => {
    creation.resolve();
    await creation.promise;
  });
  await vi.waitFor(() => expect(state.waitForProject).toHaveBeenCalledOnce());
  await leave();
  expect(screen.router?.state.location.pathname).toBe("/");

  const saved = deferred<void>();
  state.completeOnboarding.mockImplementationOnce(() => saved.promise);
  await act(async () => {
    landing.resolve();
    await landing.promise;
  });
  await vi.waitFor(() => expect(state.completeOnboarding).toHaveBeenCalledOnce());
  await leave();
  expect(screen.router?.state.location.pathname).toBe("/");

  await act(async () => {
    saved.resolve();
    await saved.promise;
  });
  await vi.waitFor(() => expect(state.onDone).toHaveBeenCalledOnce());
  expect(screen.router?.state.location.pathname).toBe("/");
  expect(state.createProject).toHaveBeenCalledTimes(2);
});

it("gives projects a later scan finds the default, unless the main box was unchecked", async () => {
  using _now = setup({ importOptedIn: true });
  await using _screen = await mountWelcome();
  // Turning on another agent rescans and finds a recent project the user has not seen.
  const findProject = (path: string) =>
    act(async () =>
      appAtomRegistry.set(candidatesAtom(), [
        ...appAtomRegistry.get(candidatesAtom()),
        candidate(path),
      ]),
    );

  await click("Review all 2");
  await click("Select none");
  await findProject("/projects/third");
  await vi.waitFor(() => expect(button("Import 1 project and start").disabled).toBe(false));

  const importProjects = document.querySelector<HTMLElement>('[role="checkbox"]');
  await act(async () => importProjects?.click());
  await findProject("/projects/fourth");
  await vi.waitFor(() => expect(button("Start").disabled).toBe(false));
});

it("keeps the project choice across a visit to Settings until setup finishes", async () => {
  using _now = setup({ importOptedIn: true });
  {
    await using _first = await mountWelcome();
    const importProjects = document.querySelector<HTMLElement>('[role="checkbox"]');
    await act(async () => importProjects?.click());
    await vi.waitFor(() => expect(button("Start").disabled).toBe(false));
  }
  // Coming back from Settings mounts the page again.
  {
    await using _second = await mountWelcome();
    expect(button("Start").disabled).toBe(false);
    await click("Start");
    await vi.waitFor(() => expect(state.onDone).toHaveBeenCalledOnce());
    expect(state.createProject).not.toHaveBeenCalled();
  }
  await using _third = await mountWelcome();
  expect(button("Start").disabled).toBe(false);
  const importProjects = document.querySelector<HTMLElement>('[role="checkbox"]');
  expect(importProjects?.getAttribute("aria-checked")).toBe("false");
  await act(async () => importProjects?.click());
  expect(button("Import 2 projects and start").disabled).toBe(false);
});

it("stays busy while setup saves after an import with nothing to open", async () => {
  using _now = setup({ importOptedIn: true });
  appAtomRegistry.set(candidatesAtom(), [candidate("/projects/first")]);
  state.importThreads.mockResolvedValue(AsyncResult.success({ importedCount: 0, skippedCount: 1 }));
  const saved = deferred<void>();
  state.completeOnboarding.mockImplementationOnce(() => saved.promise);
  await using _screen = await mountWelcome();

  await click("Import 1 project and start");
  await vi.waitFor(() => expect(state.completeOnboarding).toHaveBeenCalledOnce());
  expect(button("Importing…").disabled).toBe(true);
  await act(async () => {
    saved.resolve();
    await saved.promise;
  });
  await vi.waitFor(() => expect(state.onDone).toHaveBeenCalledOnce());
  expect(state.createProject).toHaveBeenCalledOnce();
});

it("leaves projects already in T3 Code out of the default import, unless the box is checked", async () => {
  using _now = setup({ importOptedIn: true });
  const existing = ProjectId.make("existing");
  const justAdded = ProjectId.make("just-added");
  appAtomRegistry.set(projectsAtom(), [
    { id: existing, environmentId: primaryId, workspaceRoot: "/projects/first" },
    // Added a moment ago, so the cached scan does not know it exists yet.
    { id: justAdded, environmentId: primaryId, workspaceRoot: "/projects/second" },
  ]);
  appAtomRegistry.set(candidatesAtom(), [
    candidate("/projects/first", { alreadyImported: true, projectId: existing }),
    candidate("/projects/second"),
    candidate("/projects/third"),
  ]);
  {
    await using _screen = await mountWelcome();
    await vi.waitFor(() => expect(pageText()).toContain("Import 1 project and their threads"));
  }

  // With every project already in T3 Code, checking the box still picks them.
  appAtomRegistry.set(candidatesAtom(), appAtomRegistry.get(candidatesAtom()).slice(0, 2));
  await using _screen = await mountWelcome();
  const importProjects = document.querySelector<HTMLElement>('[role="checkbox"]');
  await act(async () => importProjects?.click());
  await vi.waitFor(() => expect(pageText()).toContain("Import 2 projects and their threads"));
  expect(button("Import threads and start").disabled).toBe(false);
});

it("keeps the started projects checked when the page opens again after a quit", async () => {
  using _now = setup({ importOptedIn: true });
  const imported = deferred<{ importedCount: number; skippedCount: number }>();
  state.importThreads.mockImplementationOnce(async () =>
    AsyncResult.success(await imported.promise),
  );
  {
    await using _first = await mountWelcome();
    await click("Import 2 projects and start");
    await vi.waitFor(() => expect(state.importThreads).toHaveBeenCalledOnce());
  }
  // The app quit during the first project's history; it now exists in T3 Code.
  const [first] = appAtomRegistry.get(projectsAtom());
  appAtomRegistry.set(candidatesAtom(), [
    candidate("/projects/first", { alreadyImported: true, projectId: first!.id }),
    candidate("/projects/second"),
  ]);
  await using _second = await mountWelcome();
  await vi.waitFor(() => expect(pageText()).toContain("Import 2 projects and their threads"));
});

it("keeps the project controls when a later scan fails", async () => {
  using _now = setup({ importOptedIn: true });
  await using _screen = await mountWelcome();
  state.scanError = "The scan timed out.";
  await act(async () =>
    appAtomRegistry.set(candidatesAtom(), [...appAtomRegistry.get(candidatesAtom())]),
  );
  await vi.waitFor(() => expect(pageText()).toContain("Could not check projects again."));
  expect(button("Import 2 projects and start").disabled).toBe(false);
  expect(button("Retry").disabled).toBe(false);
});

it("keeps saved picks when Start comes before the project list loads", async () => {
  using _now = setup();
  const saved = JSON.stringify({ knownKeys: ["a"], keys: ["a"], optedOut: false });
  localStorage.setItem(welcomeImportSelectionKey(primaryId), saved);
  state.scanPending = true;
  await using _screen = await mountWelcome();

  await click("Start");
  await vi.waitFor(() => expect(state.onDone).toHaveBeenCalledOnce());
  // An import a quit cut short is still checked on the next visit.
  expect(localStorage.getItem(welcomeImportSelectionKey(primaryId))).toBe(saved);
});

it("offers Update for a signed-in agent whose version is broken, and keeps Start off", async () => {
  using _now = setup({ importOptedIn: true });
  appAtomRegistry.set(state.providers as Atom.Writable<ReadonlyArray<ServerProvider>>, [
    {
      ...readyClaude,
      compatibilityAdvisory: {
        status: "broken",
        message: "Update Claude Code to 2.0 or later.",
        recommendedVersion: "2.0.0",
        recommendedRange: null,
      },
    },
  ]);
  await using _screen = await mountWelcome();
  await vi.waitFor(() => expect(pageText()).toContain("Update Claude Code to 2.0 or later."));
  const update = [...document.querySelectorAll("a")].find(
    (element) => element.textContent?.trim() === "Update",
  );
  expect(update?.getAttribute("href")).toContain("/settings/providers");
  expect(button("Import 2 projects and start").disabled).toBe(true);
});

it("keeps an import opt-out on the page when storage cannot save it", async () => {
  using _now = setup();
  await using _screen = await mountWelcome();
  const importProjects = document.querySelector<HTMLElement>('[role="checkbox"]');
  expect(importProjects?.getAttribute("aria-checked")).toBe("false");
  await act(async () => importProjects?.click());
  expect(button("Import 2 projects and start").disabled).toBe(false);
  using _full = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  });
  await act(async () => importProjects?.click());

  await click("Start");
  await vi.waitFor(() => expect(state.onDone).toHaveBeenCalledOnce());
  expect(state.createProject).not.toHaveBeenCalled();
});

it("opens the list of agents to add once the checks find none, even after a wrong first status", async () => {
  using _now = setup();
  const pi = {
    ...readyClaude,
    instanceId: ProviderInstanceId.make("pi"),
    driver: ProviderDriverKind.make("pi"),
  };
  // Pi's first status says installed before its check runs.
  appAtomRegistry.set(state.providers as Atom.Writable<ReadonlyArray<ServerProvider>>, [
    { ...pi, status: "warning", auth: { status: "unknown" } },
  ]);
  await using _screen = await mountWelcome();
  await act(async () =>
    appAtomRegistry.set(state.providers as Atom.Writable<ReadonlyArray<ServerProvider>>, [
      { ...pi, installed: false, status: "error", auth: { status: "unknown" } },
    ]),
  );
  const fold = () =>
    [...document.querySelectorAll("button")].find((element) =>
      element.textContent?.startsWith("Set up an agent"),
    );
  await vi.waitFor(() => expect(fold()?.getAttribute("aria-expanded")).toBe("true"));

  // Turning an agent on starts a new check; the open list stays where the user is working.
  await act(async () =>
    appAtomRegistry.set(state.providers as Atom.Writable<ReadonlyArray<ServerProvider>>, [
      { ...pi, installed: false, status: "warning", auth: { status: "unknown" } },
    ]),
  );
  expect(fold()?.getAttribute("aria-expanded")).toBe("true");
});

it("starts without importing when this connection cannot import projects", async () => {
  using _now = setup();
  setGrant(primaryId, false);
  await using _screen = await mountWelcome();
  expect(pageText()).not.toContain("Review all");

  await click("Start");
  await vi.waitFor(() => expect(state.onDone).toHaveBeenCalledOnce());
  expect(state.createProject).not.toHaveBeenCalled();
});

it("says the phone is set up only once this computer is shared with the signed-in account", async () => {
  using _now = setup();
  state.cloud = true;
  state.auth = { isLoaded: true, isSignedIn: true, userId: "user_1" };
  appAtomRegistry.set(
    sessionAtom(primaryId),
    AsyncResult.success(
      session([AuthOrchestrationOperateScope, AuthRelayReadScope, AuthRelayWriteScope]),
    ),
  );
  state.linkError = "Could not read T3 Connect link state.";
  await using _screen = await mountWelcome();
  await click("Set up");
  // A failed read says so instead of asking to share the computer again.
  await vi.waitFor(() => expect(pageText()).toContain("Could not check T3 Connect."));
  expect(pageText()).not.toContain("Set up T3 Connect");

  state.linkError = null;
  await act(async () =>
    appAtomRegistry.set(state.linkState as Atom.Writable<EnvironmentCloudLinkStateResult | null>, {
      linked: false,
      cloudUserId: null,
      relayUrl: null,
      relayIssuer: null,
      publishAgentActivity: false,
    }),
  );
  // Signed in, but "Not now" on the share step left this computer unreachable.
  await vi.waitFor(() => expect(pageText()).toContain("Set up T3 Connect"));

  const share = (reachability: EnvironmentCloudLinkStateResult["reachability"]) =>
    act(async () =>
      appAtomRegistry.set(
        state.linkState as Atom.Writable<EnvironmentCloudLinkStateResult | null>,
        {
          linked: true,
          cloudUserId: "user_1",
          relayUrl: null,
          relayIssuer: null,
          managedTunnelActive: true,
          publishAgentActivity: true,
          reachability,
        },
      ),
    );
  const checkedAt = "2026-01-01T00:00:00.000Z";
  await share({
    status: "unreachable",
    checkedAt,
    cause: "connector_not_running",
    reason: "The tunnel is not running.",
    hint: null,
    fix: "Turn T3 Connect off and on.",
  });
  await vi.waitFor(() => expect(pageText()).toContain("Check T3 Connect"));
  expect(pageText()).not.toContain("Your phone can reach this computer.");

  await share({ status: "reachable", checkedAt, readyConnections: 4, protocol: "quic" });
  await vi.waitFor(() => expect(pageText()).toContain("Your phone can reach this computer."));
  expect(pageText()).not.toContain("Check T3 Connect");
});
