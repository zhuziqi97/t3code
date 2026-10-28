import { expect, it } from "vite-plus/test";
import {
  ProjectId,
  type ConveneProjectConfiguration,
  type ConveneStatus,
} from "@t3tools/contracts";
import { conveneIdeLink, conveneIdeFileTarget } from "./conveneIdeLink.ts";

const projectId = ProjectId.make("native-project");
const status: ConveneStatus = {
  phase: "online",
  baseUrl: "http://192.168.1.126:5000",
  runnerId: "runner",
  error: null,
  platformUrls: [],
};
const configuration: ConveneProjectConfiguration = {
  runner_id: "runner",
  runner_name: "Controlled",
  client_project_id: "client-project",
  project: { native_project_id: projectId, display_name: "Local" },
  targets: [
    {
      target_id: "target",
      native_workspace_key: "native-worktree-key",
      path: "/work/project",
      workspace_display_name: "Project",
      branch: null,
      availability: "AVAILABLE",
    },
  ],
  bindings: [],
  mcp_enabled: false,
  mcp_scope_modules: [],
  mcp_scope_details: [],
  binding_module_details: [],
  mcp_capabilities: { forge_enabled: false, issue_enabled: false, code_graph_enabled: false },
};

it.each(["http://192.168.1.126:5000", "http://frps.ziqi.ac.cn:11004"])(
  "keeps the active mounted entry %s and uses only native location metadata",
  (mountedOrigin) => {
    const link = new URL(
      conveneIdeLink({
        status,
        configuration,
        projectId,
        workspacePath: "/work/project/",
        mountedOrigin,
        file: { relativePath: "docs/a b.md", line: 3, column: 2 },
      })!,
    );
    expect(link.origin).toBe(mountedOrigin);
    expect(link.pathname).toBe("/clients/runner/ide");
    expect([...link.searchParams]).toEqual([
      ["projectId", projectId],
      ["workspaceKey", "native-worktree-key"],
      ["file", "docs/a b.md"],
      ["line", "3"],
      ["column", "2"],
    ]);
    expect(link.href).not.toContain("_session");
    expect(link.href).not.toContain("ticket");
  },
);

it("uses the selected environment's platform for direct clients, independent of MCP or module bindings", () => {
  expect(
    new URL(conveneIdeLink({ status, configuration, projectId, workspacePath: "/work/project" })!)
      .origin,
  ).toBe(status.baseUrl);
});

it("does not reuse another runner, project or unavailable worktree", () => {
  const input = { status, configuration, projectId, workspacePath: "/work/project" };
  expect(conveneIdeLink({ ...input, status: { ...status, runnerId: "other" } })).toBeNull();
  expect(conveneIdeLink({ ...input, projectId: ProjectId.make("other") })).toBeNull();
  expect(
    conveneIdeLink({
      ...input,
      configuration: {
        ...configuration,
        targets: configuration.targets.map((target) => ({
          ...target,
          availability: "UNAVAILABLE",
        })),
      },
    }),
  ).toBeNull();
  expect(conveneIdeLink({ ...input, workspacePath: "/work/other" })).toBeNull();
});

it("derives file and position from the executing worktree and rejects outside files", () => {
  expect(conveneIdeFileTarget("/work/tree", "/work/tree/src/main.ts:18:7", true)).toEqual({
    file: { relativePath: "src/main.ts", line: 18, column: 7 },
  });
  expect(conveneIdeFileTarget("/work/tree", "/work/tree", false)).toEqual({});
  expect(conveneIdeFileTarget("/work/tree", "/work/tree/subdir", false)).toEqual({});
  expect(conveneIdeFileTarget("/work/tree", "/work/project/src/main.ts:18", true)).toBeNull();
  expect(conveneIdeFileTarget("/work/tree", "/work/tree/../attachment.png", true)).toBeNull();
  expect(conveneIdeFileTarget("/work/tree", "/home/me/.t3/keybindings.json", true)).toBeNull();
  expect(conveneIdeFileTarget("C:\\Work\\Tree", "c:\\Work\\Tree\\src\\Main.ts:4:2", true)).toEqual({
    file: { relativePath: "src/Main.ts", line: 4, column: 2 },
  });
});

it("selects the actual worktree key instead of a different available project root", () => {
  const config = {
    ...configuration,
    targets: [
      ...configuration.targets,
      { ...configuration.targets[0]!, path: "/work/tree", native_workspace_key: "tree-key" },
    ],
  };
  const url = new URL(
    conveneIdeLink({
      status,
      configuration: config,
      projectId,
      workspacePath: "/work/tree",
      file: { relativePath: "main.ts", line: 11, column: 6 },
    })!,
  );
  expect(url.searchParams.get("workspaceKey")).toBe("tree-key");
  expect(url.searchParams.get("line")).toBe("11");
  expect(url.searchParams.get("column")).toBe("6");
});
