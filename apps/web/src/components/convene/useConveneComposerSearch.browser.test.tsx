import "~/index.css";
import { act, render } from "../../../test/render";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { AsyncResult } from "effect/reactivity";

const model = vi.hoisted(() => ({
  search: vi.fn(),
  project: vi.fn(),
  permitted: true,
  online: true,
  revision: 0,
}));
vi.mock("@effect/atom-react", async (original) => {
  const actual = await original<typeof import("@effect/atom-react")>();
  return {
    ...actual,
    useAtomValue: (atom: unknown) =>
      atom === "convene-permitted"
        ? model.permitted
        : atom === "convene-status"
          ? AsyncResult.success({ phase: model.online ? "online" : "offline" })
          : atom === "convene-changes"
            ? AsyncResult.success(model.revision)
            : actual.useAtomValue(atom as Parameters<typeof actual.useAtomValue>[0]),
  };
});
vi.mock("../../state/convene", () => ({
  conveneEnvironment: {
    searchResources: { permissionAtom: () => "convene-permitted" },
    queryProject: "project",
    status: () => "convene-status",
    resourceChanges: () => "convene-changes",
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => (command === "project" ? model.project : model.search),
}));

import { useConveneComposerSearch } from "./useConveneComposerSearch";
import { ComposerCommandMenu } from "../chat/ComposerCommandMenu";
import { changeLanguage } from "../../i18n";

const environmentId = EnvironmentId.make("environment");
const projectId = ProjectId.make("project-a");
const reference = {
  kind: "issue",
  module_id: "module",
  module_path: "owner/project/module",
  title: "Reference title",
  resource_uri: "convene://issues/owner/project/module/47",
  number: 47,
  state: "OPEN",
} as const;
const ready = (page = 1) =>
  ({ status: "ready", items: [reference], total: 21, page, page_size: 20 }) as const;

function Harness(props: { projectId?: ProjectId; query?: string; kind?: string }) {
  const search = useConveneComposerSearch({
    environmentId,
    threadId: ThreadId.make("thread"),
    projectId: props.projectId ?? projectId,
    trigger: { kind: props.kind ?? "pull-request", query: props.query ?? "47" },
  });
  return (
    <ComposerCommandMenu
      listId="convene-test"
      items={search.items}
      resolvedTheme="light"
      isLoading={search.pending}
      triggerKind="pull-request"
      activeItemId={null}
      onHighlightedItemChange={() => {}}
      onSelect={() => {}}
      conveneSearch={search}
    />
  );
}

async function setup() {
  model.search.mockReset().mockResolvedValue(AsyncResult.success(ready()));
  model.project.mockReset().mockResolvedValue(
    AsyncResult.success({
      fresh: true,
      configuration: { mcp_enabled: true, mcp_scope_modules: [{ module_id: "module" }] },
    }),
  );
  model.permitted = true;
  model.online = true;
  model.revision = 0;
  await changeLanguage("en");
}

it("clears a previous project's candidates and ignores a late response", async () => {
  await setup();
  let finish!: (value: ReturnType<typeof AsyncResult.success>) => void;
  const delayed = new Promise<ReturnType<typeof AsyncResult.success>>((resolve) => {
    finish = resolve;
  });
  model.search.mockReturnValueOnce(delayed);
  await using screen = await render(<Harness />);
  await vi.waitFor(() => expect(model.search).toHaveBeenCalledTimes(1));
  await screen.rerender(<Harness projectId={ProjectId.make("project-b")} />);
  await vi.waitFor(() => expect(model.search).toHaveBeenCalledTimes(2));
  await expect.element(screen.getByText("Convene #47", { exact: true })).toBeVisible();
  await act(async () =>
    finish(
      AsyncResult.success({
        ...ready(),
        items: [
          { ...reference, number: 99, resource_uri: "convene://issues/owner/project/module/99" },
        ],
      }),
    ),
  );
  await expect.element(screen.getByText("Convene #99", { exact: true })).not.toBeInTheDocument();
  expect(model.search.mock.calls[1]?.[0].input.projectId).toBe("project-b");
});

it("paginates the authorized scope and distinguishes a denied refresh", async () => {
  await setup();
  await using screen = await render(<Harness />);
  await expect.element(screen.getByText("Convene #47", { exact: true })).toBeVisible();
  model.search.mockResolvedValueOnce(
    AsyncResult.success({ ...ready(2), items: [{ ...reference, number: 48 }] }),
  );
  await screen.getByRole("button", { name: "Next Convene results" }).click();
  await expect.element(screen.getByText("Convene #48", { exact: true })).toBeVisible();
  expect(model.search.mock.calls[1]?.[0].input).toEqual({
    projectId,
    kind: "issue",
    query: "47",
    page: 2,
    pageSize: 20,
  });
  model.search.mockResolvedValueOnce(AsyncResult.success({ status: "scopeInsufficient" }));
  await screen.getByRole("button", { name: "Refresh Convene results" }).click();
  await expect.element(screen.getByText("Convene #48", { exact: true })).not.toBeInTheDocument();
  await expect
    .element(screen.getByText("Convene · This project has no authorized resource scope."))
    .toBeVisible();
});

it("offers a real MCP guideline reference and removes it when access is disabled", async () => {
  await setup();
  await using screen = await render(<Harness kind="skill" query="convene" />);
  await expect.element(screen.getByText("Convene", { exact: true })).toBeVisible();
  model.project.mockResolvedValueOnce(
    AsyncResult.success({ fresh: true, configuration: { mcp_enabled: false } }),
  );
  model.revision++;
  await screen.rerender(<Harness kind="skill" query="convene" />);
  await expect.element(screen.getByText("Convene", { exact: true })).not.toBeInTheDocument();
  await expect
    .element(screen.getByText("Convene · Enable MCP for this project to search resources."))
    .toBeVisible();
  expect(model.search).not.toHaveBeenCalled();
});
