import { EnvironmentId, ThreadId, type ThreadWorkspaceState } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../test/render";

const model = vi.hoisted(() => ({
  permitted: true,
  query: vi.fn(),
  recover: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<typeof import("@effect/atom-react")>()),
  useAtomValue: () => model.permitted,
}));
vi.mock("../state/entities", () => ({ useQuietThreadShell: () => null }));
vi.mock("../state/query", () => ({ useEnvironmentQuery: () => model.query() }));
vi.mock("../state/workspaceRecovery", () => ({
  workspaceRecoveryEnvironment: {
    inspect: () => null,
    recover: { permissionAtom: () => true },
  },
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => model.recover }));
import { ThreadWorkspaceRecovery } from "./ThreadWorkspaceRecovery";
import { changeLanguage } from "../i18n";

const environmentId = EnvironmentId.make("recovery-environment");
const threadId = ThreadId.make("original-thread");
function setup(available = false) {
  model.permitted = true;
  model.query.mockReset();
  model.recover.mockReset();
  model.refresh.mockReset();
  const state: ThreadWorkspaceState = {
    path: "/project/deleted",
    available,
    choices: [
      { path: "/project", worktreePath: null, branch: "main", displayName: "Project folder" },
      {
        path: "/project/worktree",
        worktreePath: "/project/worktree",
        branch: "feature",
        displayName: "Other worktree",
      },
    ],
  };
  model.query.mockImplementation(() => ({ data: state, error: null, refresh: model.refresh }));
  return state;
}

it("lets the user select a project checkout, see a failure, and retry without losing the conversation target", async () => {
  const state = setup();
  await changeLanguage("en");
  model.recover.mockResolvedValueOnce(
    AsyncResult.failure(Cause.fail(new Error("Workspace report failed"))),
  );
  model.recover.mockImplementationOnce(async () => {
    const next = { ...state, available: true };
    model.query.mockReturnValue({ data: next, error: null, refresh: model.refresh });
    return AsyncResult.success(next);
  });
  await using screen = await render(
    <ThreadWorkspaceRecovery environmentId={environmentId} threadId={threadId} />,
  );
  const useWorkspace = screen.getByRole("button", { name: "Use selected workspace" });
  await expect.element(useWorkspace).toBeDisabled();
  await screen
    .getByRole("combobox", { name: "Project checkout or worktree" })
    .selectOptions("/project");
  await useWorkspace.click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Workspace report failed");
  await useWorkspace.click();
  await expect
    .element(screen.getByText("Workspace unavailable", { exact: true }))
    .not.toBeInTheDocument();
  expect(model.recover).toHaveBeenCalledTimes(2);
  for (const [input] of model.recover.mock.calls)
    expect(input).toMatchObject({ environmentId, input: { threadId, worktreePath: null } });
});

it("shows the existing worktree path as an explicit choice and honors the destination permission", async () => {
  setup();
  await changeLanguage("en");
  model.permitted = false;
  await using screen = await render(
    <ThreadWorkspaceRecovery environmentId={environmentId} threadId={threadId} />,
  );
  await expect.element(screen.getByRole("combobox")).toBeDisabled();
  await expect
    .element(screen.getByRole("button", { name: "Use selected workspace" }))
    .toBeDisabled();
  await screen.getByRole("button", { name: "Refresh workspaces" }).click();
  expect(model.refresh).toHaveBeenCalledTimes(1);
  expect(model.recover).not.toHaveBeenCalled();
});
