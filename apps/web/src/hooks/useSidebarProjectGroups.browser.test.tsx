import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../test/render";
import type { Project } from "../types";
import { getProjectOrderKey } from "../logicalProject";

const state = vi.hoisted(() => ({
  projects: [] as Project[],
  order: [] as string[],
  sort: "updated_at",
}));
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => state.projects) as never,
}));
vi.mock(import("../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironmentIdentities: (() => [{ environmentId: "local", label: "Local" }]) as never,
  usePrimaryEnvironmentId: (() => "local") as never,
}));
vi.mock(import("../uiStateStore"), async (original) => ({
  ...(await original()),
  useUiStateStore: ((select: (store: unknown) => unknown) =>
    select({ projectOrder: state.order })) as never,
}));
vi.mock(import("./useSettings"), async (original) => ({
  ...(await original()),
  useClientSettings: ((select: (settings: unknown) => unknown) =>
    select({
      sidebarProjectSortOrder: state.sort,
      sidebarProjectGroupingMode: "separate",
      sidebarProjectGroupingOverrides: {},
    })) as never,
}));

import { useSidebarProjectGroups } from "./useSidebarProjectGroups";

function ProjectOrder() {
  const groups = useSidebarProjectGroups();
  return (
    <ol>
      {groups.map((group) => (
        <li key={group.projectKey}>{group.displayName}</li>
      ))}
    </ol>
  );
}
function project(id: string, createdAt: string): Project {
  return {
    environmentId: EnvironmentId.make("local"),
    id: ProjectId.make(id),
    title: id,
    workspaceRoot: `/mock/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt,
    updatedAt: createdAt,
  };
}
function setup() {
  state.projects = [
    project("a", "2026-10-20T00:00:00.000Z"),
    project("b", "2026-10-21T00:00:00.000Z"),
  ];
  state.order = state.projects.map(getProjectOrderKey);
  state.sort = "updated_at";
}

it("keeps saved manual project order despite an old activity-sort setting and reconnect ordering", async () => {
  setup();
  await using screen = await render(<ProjectOrder />);
  const order = () => [...screen.container.querySelectorAll("li")].map((item) => item.textContent);
  expect(order()).toEqual(["a", "b"]);
  state.projects = state.projects
    .map((entry) => ({ ...entry, updatedAt: "2026-10-22T10:00:00.000Z" }))
    .toReversed();
  await screen.rerender(<ProjectOrder />);
  expect(order()).toEqual(["a", "b"]);
  state.order = [...state.order].toReversed();
  await screen.rerender(<ProjectOrder />);
  expect(order()).toEqual(["b", "a"]);
  state.sort = "created_at";
  await screen.rerender(<ProjectOrder />);
  expect(order()).toEqual(["b", "a"]);
});

it("uses stable creation order for projects without saved preferences", async () => {
  setup();
  state.order = [];
  await using screen = await render(<ProjectOrder />);
  const order = () => [...screen.container.querySelectorAll("li")].map((item) => item.textContent);
  expect(order()).toEqual(["b", "a"]);
  state.projects = state.projects
    .toReversed()
    .map((entry) => ({ ...entry, updatedAt: "2026-10-22T12:00:00.000Z" }));
  await screen.rerender(<ProjectOrder />);
  expect(order()).toEqual(["b", "a"]);
});
