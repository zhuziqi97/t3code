import "~/index.css";
import { page } from "vite-plus/test/browser";
import { act, render } from "../../../test/render";

import { changeLanguage } from "../../i18n";
import { stubGlobal } from "../../../test/render";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  importThreads: vi.fn(),
  createProject: vi.fn(),
  complete: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
  cloudEnabled: false,
  openAuthPrompt: vi.fn(),
  projects: [] as Array<{ id: string; environmentId: string; workspaceRoot: string }>,
}));
vi.mock("../../state/session", async (original) => ({
  ...(await original<typeof import("../../state/session")>()),
  useEnvironmentScope: () => true,
  useEnvironmentsWithScope: (environments: Array<{ environmentId: string }>) =>
    new Set(environments.map((entry) => entry.environmentId)),
  readEnvironmentScope: () => true,
}));
vi.mock("../../state/agentSessions", async (original) => ({
  ...(await original<typeof import("../../state/agentSessions")>()),
  agentSessionImport: "import",
}));
vi.mock("../../state/projects", async (original) => ({
  ...(await original<typeof import("../../state/projects")>()),
  projectEnvironment: { create: "create" },
}));
vi.mock("../../state/use-atom-command", async (original) => ({
  ...(await original<typeof import("../../state/use-atom-command")>()),
  useAtomCommand: (command: string) =>
    command === "import"
      ? mocks.importThreads
      : command === "create"
        ? mocks.createProject
        : mocks.refresh,
}));
vi.mock("../../onboarding/firstRun", async (original) => ({
  ...(await original<typeof import("../../onboarding/firstRun")>()),
  completeOnboarding: mocks.complete,
}));
vi.mock("../../state/entities", async (original) => ({
  ...(await original<typeof import("../../state/entities")>()),
  useProjects: () => mocks.projects,
  readProjects: () => mocks.projects,
}));
vi.mock("../../state/environments", async (original) => {
  const environment = {
    environmentId: "test-env",
    label: "Computer",
    connection: { phase: "connected" },
    entry: {
      enabled: true,
      target: { _tag: "DirectConnectionTarget", url: "http://localhost:43123" },
    },
  };
  return {
    ...(await original<typeof import("../../state/environments")>()),
    useEnvironments: () => ({ environments: [environment] }),
    usePrimaryEnvironment: () => environment,
  };
});
vi.mock("../../state/server", async (original) => ({
  ...(await original<typeof import("../../state/server")>()),
  serverEnvironment: {
    providersValueAtom: () => [],
    configValueAtom: () => null,
    refreshProviders: "refresh",
  },
}));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAtomValue: (value: unknown) => value,
}));
vi.mock("../../onboarding/useProjectScans", async (original) => ({
  ...(await original<typeof import("../../onboarding/useProjectScans")>()),
  useProjectScans: () => [
    {
      environmentId: "test-env",
      isPending: false,
      error: null,
      refresh: mocks.refresh,
      data: {
        truncated: false,
        candidates: [
          {
            path: "/project",
            title: "project",
            projectId: "test-project",
            threadCount: 29,
            lastActiveAt: new Date().toISOString(),
            sources: ["codex"],
          },
        ],
      },
    },
  ],
}));
vi.mock("../../connection/onboarding", async (original) => ({
  ...(await original<typeof import("../../connection/onboarding")>()),
  connectPairing: vi.fn(),
}));
vi.mock("../../state/terminal", async (original) => ({
  ...(await original<typeof import("../../state/terminal")>()),
  terminalEnvironment: {},
}));
vi.mock("../clerk/useT3ConnectAuthPrompt", async (original) => ({
  ...(await original<typeof import("../clerk/useT3ConnectAuthPrompt")>()),
  useT3ConnectAuthPrompt: () => ({ openAuthPrompt: mocks.openAuthPrompt }),
}));
vi.mock(import("../../cloud/publicConfig"), async (original) => ({
  ...(await original()),
  hasCloudPublicConfig: () => mocks.cloudEnabled,
}));
vi.mock("../ThreadTerminalDrawer", async (original) => ({
  ...(await original<typeof import("../ThreadTerminalDrawer")>()),
  TerminalViewport: () => null,
}));
vi.mock("../settings/ChatGptWelcomeCoordinator", async (original) => ({
  ...(await original<typeof import("../settings/ChatGptWelcomeCoordinator")>()),
  ChatGptWelcomeCoordinator: () => null,
}));
vi.mock("../settings/CodexSetupSection", async (original) => ({
  ...(await original<typeof import("../settings/CodexSetupSection")>()),
  CodexSetupSection: () => null,
  AddManagedCodexAccountDialog: () => null,
}));
vi.mock("../cloud/CloudEnvironmentConnectList", async (original) => ({
  ...(await original<typeof import("../cloud/CloudEnvironmentConnectList")>()),
  CloudEnvironmentConnectRows: () => null,
}));
vi.mock("../ui/toast", async (original) => ({
  ...(await original<typeof import("../ui/toast")>()),
  toastManager: { add: mocks.toast, close: vi.fn(), update: vi.fn() },
}));

import { WelcomeWizard } from "./WelcomeWizard";

function setup() {
  using stack = new DisposableStack();
  vi.clearAllMocks();
  mocks.cloudEnabled = false;
  stack.use(
    stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    ),
  );
  stack.use(vi.spyOn(Element.prototype, "getAnimations").mockReturnValue([]));
  mocks.projects = [{ id: "test-project", environmentId: "test-env", workspaceRoot: "/project" }];
  mocks.complete.mockReset().mockResolvedValue(undefined);
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.importThreads
    .mockReset()
    .mockResolvedValue({ _tag: "Success", value: { importedCount: 28, skippedCount: 1 } });
  return stack.move();
}

async function click(label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
}

it("enters the workspace after a partial import and warns after navigation finishes", async () => {
  await using _lifecycle = await setupLifecycle();

  using _setup = setup();
  let finishNavigation = () => {};
  const navigation = new Promise<void>((resolve) => {
    finishNavigation = resolve;
  });
  const onDone = vi.fn(() => navigation);
  await using _screen = await render(<WelcomeWizard localAvailable onDone={onDone} />);
  await click("Continue");
  await click("Continue");
  await click("Continue to projects");
  await click("Import 1 project");
  expect(onDone).toHaveBeenCalledWith({
    environmentId: EnvironmentId.make("test-env"),
    projectId: ProjectId.make("test-project"),
  });
  expect(mocks.toast).not.toHaveBeenCalled();
  await act(async () => finishNavigation());
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "warning",
      description: "Imported 28 threads. 1 thread could not be imported.",
    }),
  );
  expect(mocks.toast.mock.invocationCallOrder[0]).toBeGreaterThan(
    onDone.mock.invocationCallOrder[0]!,
  );
});

it.each([
  [0, 0, null],
  [29, 0, null],
  [1, 0, null],
  [0, 1, "1 thread could not be imported."],
  [0, 2, "2 threads could not be imported."],
] as const)(
  "finishes setup with %i imported and %i skipped threads",
  async (importedCount, skippedCount, warning) => {
    await using _lifecycle = await setupLifecycle();

    using _setup = setup();
    mocks.importThreads.mockResolvedValue({
      _tag: "Success",
      value: { importedCount, skippedCount },
    });
    const onDone = vi.fn();
    await using _screen = await render(<WelcomeWizard localAvailable onDone={onDone} />);
    await click("Continue");
    await click("Continue");
    await click("Continue to projects");
    await click("Import 1 project");
    expect(onDone).toHaveBeenCalledOnce();
    if (warning === null && importedCount > 0) {
      expect(mocks.toast).toHaveBeenCalledWith({
        type: "success",
        title: `Imported ${importedCount} ${importedCount === 1 ? "thread" : "threads"}`,
      });
    } else if (warning === null) {
      expect(mocks.toast).not.toHaveBeenCalled();
    } else {
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "warning", description: warning }),
      );
    }
  },
);

it("keeps setup open when saving completion fails and preserves the import warning on retry", async () => {
  await using _lifecycle = await setupLifecycle();

  using _setup = setup();
  mocks.complete.mockRejectedValueOnce(new Error("settings unavailable"));
  const onDone = vi.fn();
  await using _screen = await render(<WelcomeWizard localAvailable onDone={onDone} />);
  await click("Continue");
  await click("Continue");
  await click("Continue to projects");
  await click("Import 1 project");
  expect(onDone).not.toHaveBeenCalled();
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({ type: "error", title: "Could not finish setup" }),
  );
  await click("Do not import projects");
  expect(onDone).toHaveBeenCalledOnce();
  expect(mocks.importThreads).toHaveBeenCalledOnce();
  expect(mocks.toast).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: "warning",
      description: "Imported 28 threads. 1 thread could not be imported.",
    }),
  );
});

it("requires explicit Close to complete local setup", async () => {
  await using _lifecycle = await setupLifecycle();

  using _setup = setup();
  const onDone = vi.fn();
  await using _screen = await render(<WelcomeWizard localAvailable onDone={onDone} />);
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    const backdrop = document.querySelector<HTMLElement>('[data-slot="dialog-backdrop"]')!;
    backdrop.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
    );
    backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    backdrop.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    backdrop.click();
  });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();

  const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
  expect(close).not.toBeNull();
  await act(async () => close!.click());
  expect(mocks.complete).toHaveBeenCalledOnce();
  expect(onDone).toHaveBeenCalledWith(undefined);
});

it("updates the signed-out T3 Connect action when the language changes and still opens sign-in", async () => {
  await using _lifecycle = await setupLifecycle();

  using _setup = setup();
  mocks.cloudEnabled = true;
  await using _screen = await render(<WelcomeWizard localAvailable onDone={vi.fn()} />);
  const connectButton = [...document.querySelectorAll("button")].find((element) =>
    element.textContent?.includes("T3 Connect"),
  );
  expect(connectButton).toBeDefined();
  expect(connectButton!.textContent).toContain("Sign in");
  await act(async () => {
    await changeLanguage("zh");
  });
  expect(connectButton!.textContent).toContain("登录");
  await act(async () => connectButton!.click());
  expect(mocks.openAuthPrompt).toHaveBeenCalledOnce();
});

it("updates connection status and pairing instructions without changing commands", async () => {
  await using _lifecycle = await setupLifecycle();

  using _setup = setup();
  await using _screen = await render(<WelcomeWizard localAvailable onDone={vi.fn()} />);
  await click("Add a computer");
  await click("Need a pairing link?");
  expect(document.body.textContent).toContain(
    "Start T3 Code first, or run npx t3 serve. Add --tailscale to use your tailnet.",
  );

  await act(async () => {
    await changeLanguage("zh");
  });
  expect(document.body.textContent).toContain("已连接");
  expect(document.body.textContent).toContain(
    "请先启动 T3 Code，或运行 npx t3 serve。添加 --tailscale 参数即可使用你的 Tailscale 网络。",
  );
  expect([...document.body.querySelectorAll("code")].map((element) => element.textContent)).toEqual(
    expect.arrayContaining(["npx t3 serve", "--tailscale"]),
  );

  await act(async () => {
    await changeLanguage("en");
  });
  expect(document.body.textContent).toContain("Connected");
  expect(document.body.textContent).toContain(
    "Start T3 Code first, or run npx t3 serve. Add --tailscale to use your tailnet.",
  );
});

async function setupLifecycle() {
  await changeLanguage("en");
  await using stack = new AsyncDisposableStack();
  stack.defer(async () => {
    await changeLanguage("en");
  });

  return stack.move();
}

vi.mock(import("@clerk/react"), async (original) => ({
  ...(await original()),
  useAuth: () => ({ isLoaded: true, isSignedIn: false }) as never,
}));
