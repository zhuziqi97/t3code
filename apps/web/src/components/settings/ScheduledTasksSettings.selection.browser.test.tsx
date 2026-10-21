import "~/index.css";
import { render } from "../../../test/render";
import {
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  ScheduledTaskId,
  type ScheduledTask,
  type ScheduledTaskUpsertInput,
  type ServerProvider,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { AsyncResult, type Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  task: null as ScheduledTask | null,
  providers: null as Atom.Writable<readonly ServerProvider[]> | null,
  upsert:
    vi.fn<
      (input: { environmentId: EnvironmentId; input: ScheduledTaskUpsertInput }) => Promise<unknown>
    >(),
}));

vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  state.providers = Atom.make<readonly ServerProvider[]>([]);
  const allowed = Atom.make(true);
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      providersValueAtom: () => state.providers!,
      upsertScheduledTask: {
        ...actual.serverEnvironment.upsertScheduledTask,
        permissionAtom: () => allowed,
      },
    },
  };
});
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.upsert) as never,
}));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => true,
}));
vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useEnvironmentSettings: (() => state.settings) as never,
}));
vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({
    data: { tasks: [state.task!] },
    error: null,
    isPending: false,
  })) as never,
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironment: (() => environment) as never,
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => [
    {
      id: projectId,
      environmentId,
      title: "Test project",
      workspaceRoot: "/mock/scheduled-project",
    },
  ]) as never,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => ({
    scope: { kind: "all", environmentIds: [environmentId] },
    environments: [environment],
    connectedEnvironments: [environment],
    environment,
  })) as never,
}));

import { changeLanguage } from "../../i18n";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { toastManager } from "../ui/toast";
import { ScheduledTasksSettings } from "./ScheduledTasksSettings";

const environmentId = EnvironmentId.make("selection-test");
const projectId = ProjectId.make("project");
const environment = {
  environmentId,
  label: "Test environment",
  connection: { phase: "connected" },
  serverConfig: { environment: { platform: "linux" } },
};

function setup(mode: "missing" | "disabled") {
  state.settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "environment-model",
    },
  };
  state.task = {
    id: ScheduledTaskId.make("saved-task"),
    title: "Saved task",
    prompt: "Keep the original route",
    enabled: true,
    schedule: { type: "interval", everyMs: 60_000 },
    projectId,
    threadId: null,
    workspaceStrategy: { type: "root" },
    modelSelection: {
      instanceId: ProviderInstanceId.make(`${mode}-instance`),
      model: mode === "missing" ? "exact:model-id" : null,
      options: [{ id: "native-option", value: "native-value" }],
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdBy: "user",
    creationSource: "web",
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: "never",
    lastRunError: null,
    runCount: 0,
  };
  const provider: ServerProvider = {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-21T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  };
  appAtomRegistry.set(
    state.providers!,
    mode === "missing"
      ? [provider]
      : [
          provider,
          {
            ...provider,
            instanceId: state.task.modelSelection.instanceId,
            enabled: false,
          },
        ],
  );
  state.upsert
    .mockReset()
    .mockResolvedValue(AsyncResult.fail(new Error("Provider instance unavailable")));
}

it.each(["missing", "disabled"] as const)(
  "keeps a saved %s instance and native selection through a rejected save and retry",
  async (mode) => {
    setup(mode);
    await changeLanguage("en");
    await page.viewport(1280, 900);
    await using _screen = await render(
      <ScheduledTasksSettings environmentId={environmentId} taskId={state.task!.id} />,
    );
    using added = vi.spyOn(toastManager, "add");
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await expect
      .element(page.getByText(`The selected provider is unavailable (${mode}-instance).`))
      .toBeVisible();
    await userEvent.fill(page.getByRole("textbox", { name: "Name", exact: true }), "Renamed task");
    await expect
      .element(page.getByRole("button", { name: "Save task", exact: true }))
      .toBeEnabled();
    await userEvent.click(page.getByRole("button", { name: "Save task", exact: true }));
    await vi.waitFor(() => expect(state.upsert).toHaveBeenCalledOnce());
    expect(state.upsert.mock.calls[0]![0]).toMatchObject({
      environmentId,
      input: {
        id: state.task!.id,
        requireExisting: true,
        title: "Renamed task",
        modelSelection: state.task!.modelSelection,
      },
    });
    await vi.waitFor(() =>
      expect(added).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Could not save scheduled task",
          description: "Provider instance unavailable",
        }),
      ),
    );
    await expect.element(page.getByRole("dialog")).toBeVisible();
    state.upsert.mockResolvedValue(AsyncResult.success({}));
    await userEvent.click(page.getByRole("button", { name: "Save task", exact: true }));
    await vi.waitFor(() => expect(state.upsert).toHaveBeenCalledTimes(2));
    expect(state.upsert.mock.calls[1]![0].input.modelSelection).toEqual(state.task!.modelSelection);
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  },
);
