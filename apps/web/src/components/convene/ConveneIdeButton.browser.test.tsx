import "~/index.css";
import { render, stubGlobal } from "../../../test/render";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { AsyncResult } from "effect/reactivity";

const model = vi.hoisted(() => ({
  open: vi.fn(),
  permitted: true,
  fresh: true,
  currentProject: "native-project",
}));
vi.mock("@effect/atom-react", async (original) => {
  const actual = await original<typeof import("@effect/atom-react")>();
  return {
    ...actual,
    useAtomValue: (atom: unknown) =>
      atom === "convene-status"
        ? AsyncResult.success({
            phase: "online",
            runnerId: "runner",
            baseUrl: "http://192.168.1.126:5000",
            platformUrls: [],
            error: null,
          })
        : actual.useAtomValue(atom as Parameters<typeof actual.useAtomValue>[0]),
  };
});
vi.mock("../../state/convene", () => ({
  conveneEnvironment: { status: () => "convene-status", projectView: () => "project" },
}));
vi.mock("../../state/session", () => ({ useEnvironmentScope: () => model.permitted }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) => ({
    isPending: false,
    data: atom
      ? {
          fresh: model.fresh,
          configuration: {
            runner_id: "runner",
            project: { native_project_id: model.currentProject },
            targets: [
              {
                availability: "AVAILABLE",
                path: "/work/project",
                native_workspace_key: "native-key",
              },
            ],
            mcp_enabled: false,
            bindings: [],
          },
        }
      : null,
  }),
}));
vi.mock("../../localApi", () => ({
  readLocalApi: () => ({ shell: { openExternal: model.open } }),
}));

import { ConveneIdeButton } from "./ConveneIdeButton";
import { changeLanguage } from "../../i18n";

const environmentId = EnvironmentId.make("environment");
const projectId = ProjectId.make("native-project");

async function setup() {
  model.open.mockReset().mockResolvedValue(undefined);
  model.permitted = true;
  model.fresh = true;
  model.currentProject = projectId;
  await changeLanguage("en");
}

it.each(["/clients/runner/workspaces/current", "/client-web/legacy-session"])(
  "opens a fresh IDE entry from %s on the current origin with a native file location, even with MCP off",
  async (pageBase) => {
    await setup();
    using _pageBase = stubGlobal("__T3_BASE_PATH__", pageBase);
    await using screen = await render(
      <ConveneIdeButton
        environmentId={environmentId}
        projectId={projectId}
        workspacePath="/work/project"
        file={{ relativePath: "README.md", line: 3, column: 2 }}
      />,
    );
    await screen.getByRole("button", { name: "Open Web IDE" }).click();
    const url = new URL(model.open.mock.calls[0]?.[0]);
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe("/clients/runner/ide");
    expect(url.searchParams.get("workspaceKey")).toBe("native-key");
    expect(url.searchParams.get("file")).toBe("README.md");
    expect(url.searchParams.get("line")).toBe("3");
    expect(url.searchParams.get("column")).toBe("2");
    expect(url.href).not.toContain("_session");
  },
);

it("prevents an old project response or a read-only environment session from opening the IDE", async () => {
  await setup();
  model.currentProject = "previous-project";
  await using screen = await render(
    <ConveneIdeButton
      environmentId={environmentId}
      projectId={projectId}
      workspacePath="/work/project"
    />,
  );
  await expect.element(screen.getByRole("button", { name: "Open Web IDE" })).toBeDisabled();
  model.currentProject = projectId;
  model.permitted = false;
  await screen.rerender(
    <ConveneIdeButton
      environmentId={environmentId}
      projectId={projectId}
      workspacePath="/work/project"
    />,
  );
  await expect.element(screen.getByRole("button", { name: "Open Web IDE" })).toBeDisabled();
  expect(model.open).not.toHaveBeenCalled();
});
