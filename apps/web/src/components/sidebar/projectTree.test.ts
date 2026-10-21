import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { buildSidebarProjectSnapshots } from "../../sidebarProjectGrouping";
import { buildProjectTreeList, sortProjectTreeActiveThreads } from "./projectTree";
import {
  resolveSidebarDropTarget,
  sidebarMarkerId,
  sidebarListItemId,
  type SidebarListItem,
} from "../Sidebar.logic";
import type { Project } from "../../types";

const environmentId = EnvironmentId.make("local");
function project(id: string): Project {
  return {
    environmentId,
    id: ProjectId.make(id),
    title: id,
    workspaceRoot: `/work/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-10-10T00:00:00Z",
    updatedAt: "2026-10-10T00:00:00Z",
  };
}
const groups = buildSidebarProjectSnapshots({
  projects: [project("a"), project("b"), project("empty")],
  settings: { sidebarProjectGroupingMode: "separate", sidebarProjectGroupingOverrides: {} },
  primaryEnvironmentId: environmentId,
  resolveEnvironmentLabel: () => null,
});
const a = groups[0]!.projectKey;
const b = groups[1]!.projectKey;
const thread = (id: string, projectId: string) => ({
  id: ThreadId.make(id),
  environmentId,
  projectId: ProjectId.make(projectId),
});
const build = (expandedById: Record<string, boolean> = {}) =>
  buildProjectTreeList({
    groups,
    expandedById,
    pinned: [thread("pin", "a")],
    active: [thread("a1", "a"), thread("b1", "b"), thread("a2", "a")],
    working: [],
    workingAll: [],
    snoozed: [],
    snoozedAll: [thread("sleep", "b")],
    settled: [],
    settledAll: [],
  });

describe("project tree visibility and drop boundaries", () => {
  it("renders pins once, groups interleaved activity, and retains empty projects", () => {
    const items = build();
    expect(items.filter((item) => item.kind === "thread").map(sidebarListItemId)).toEqual([
      "local:pin",
      "local:a1",
      "local:a2",
      "local:b1",
    ]);
    expect(
      items.filter((item) => item.kind === "marker" && item.marker === "project-header"),
    ).toHaveLength(3);
    expect(new Set(items.map(sidebarListItemId)).size).toBe(items.length);
  });
  it("folding A removes its child rows from navigation but retains the global pin and other projects", () => {
    expect(
      build({ [a]: false })
        .filter((item) => item.kind === "thread")
        .map(sidebarListItemId),
    ).toEqual(["local:pin", "local:b1"]);
  });
  it("retains a collapsed shelf's entry without exposing its hidden rows", () => {
    const items = build();
    expect(items.map(sidebarListItemId)).toContain(sidebarMarkerId("snoozed-header", b));
    expect(items.map(sidebarListItemId)).not.toContain("local:sleep");
  });
  it("rejects cross-project moves, including an empty target", () => {
    const items = build();
    expect(resolveSidebarDropTarget(items, "local:a1", "local:b1")).toBeNull();
    expect(
      resolveSidebarDropTarget(items, "local:pin", sidebarMarkerId("active-placeholder", b)),
    ).toBeNull();
  });
  it("reorders within a project using only its visible neighbors", () => {
    expect(resolveSidebarDropTarget(build(), "local:a1", "local:a2")?.activeOrder).toEqual([
      "local:a2",
      "local:a1",
    ]);
  });
  it("leaves order unchanged when an invalid drop falls back to the dragged row", () => {
    expect(resolveSidebarDropTarget(build(), "local:a2", "local:a2")).toBeNull();
    expect(resolveSidebarDropTarget(build(), "local:pin", "local:pin")).toBeNull();
  });
  it("allows pinning globally and unpinning only into the owning project", () => {
    expect(resolveSidebarDropTarget(build(), "local:b1", "local:pin")?.section).toBe("pinned");
    expect(resolveSidebarDropTarget(build(), "local:pin", "local:a1")?.section).toBe("active");
    expect(resolveSidebarDropTarget(build(), "local:pin", "local:b1")).toBeNull();
  });
  it("settles into the owning project's header, and never into working or snoozed", () => {
    const items = build();
    expect(
      resolveSidebarDropTarget(items, "local:a1", sidebarMarkerId("settled-header", a))?.section,
    ).toBe("settled");
    expect(
      resolveSidebarDropTarget(items, "local:b1", sidebarMarkerId("snoozed-header", b)),
    ).toBeNull();
  });
  it("keeps flat sidebar drop behavior available to the existing consumers", () => {
    const items: SidebarListItem[] = [
      { kind: "marker", marker: "pinned-header" },
      { kind: "thread", key: "pin", section: "pinned" },
      { kind: "marker", marker: "pinned-divider" },
      { kind: "thread", key: "active", section: "active" },
    ];
    expect(resolveSidebarDropTarget(items, "active", "pin")?.section).toBe("pinned");
  });
});

it("pages settled history separately for each project and reveals a deep linked thread", async () => {
  const { visibleProjectShelfThreads } = await import("./projectTree");
  const projectKeyByRef = new Map([
    ["local:a", a],
    ["local:b", b],
  ]);
  const list = [
    thread("a1", "a"),
    thread("a2", "a"),
    thread("a3", "a"),
    thread("b1", "b"),
    thread("b2", "b"),
  ];
  expect(
    visibleProjectShelfThreads({
      threads: list,
      projectKeyByRef,
      isExpanded: () => true,
      routeThreadKey: "local:a3",
      limitForProject: () => 1,
    }).map((entry) => entry.id),
  ).toEqual(["a1", "a3", "b1"]);
  expect(
    visibleProjectShelfThreads({
      threads: list,
      projectKeyByRef,
      isExpanded: (key) => key === b,
      routeThreadKey: null,
    }).map((entry) => entry.id),
  ).toEqual(["b1", "b2"]);
});

describe("project-local user message order", () => {
  it("raises only the sending thread inside its project and keeps projects and pins stable", () => {
    const at = (hour: number) => `2026-10-21T${String(hour).padStart(2, "0")}:00:00.000Z`;
    const active = [
      { ...thread("a1", "a"), createdAt: at(1), latestUserMessageAt: at(4), updatedAt: at(4) },
      { ...thread("a2", "a"), createdAt: at(2), latestUserMessageAt: at(3), updatedAt: at(3) },
      { ...thread("a3", "a"), createdAt: at(3), latestUserMessageAt: null, updatedAt: at(9) },
      { ...thread("b1", "b"), createdAt: at(1), latestUserMessageAt: at(8), updatedAt: at(8) },
      { ...thread("b2", "b"), createdAt: at(2), latestUserMessageAt: at(7), updatedAt: at(7) },
      { ...thread("b3", "b"), createdAt: at(3), latestUserMessageAt: null, updatedAt: at(9) },
    ];
    const pins = [thread("pin-b", "b"), thread("pin-a", "a")];
    const tree = (threads: typeof active, expandedById: Record<string, boolean> = {}) =>
      buildProjectTreeList({
        groups,
        expandedById,
        pinned: pins,
        active: sortProjectTreeActiveThreads(threads),
        working: [],
        workingAll: [],
        snoozed: [],
        snoozedAll: [],
        settled: [],
        settledAll: [],
      });
    const ids = (items: ReturnType<typeof tree>) =>
      items.filter((item) => item.kind === "thread").map(sidebarListItemId);
    const initial = tree(active);
    expect(ids(initial)).toEqual([
      "local:pin-b",
      "local:pin-a",
      "local:a1",
      "local:a2",
      "local:a3",
      "local:b1",
      "local:b2",
      "local:b3",
    ]);
    const sent = active.map((entry) =>
      entry.id === "a2" ? { ...entry, latestUserMessageAt: at(10), updatedAt: at(10) } : entry,
    );
    expect(ids(tree(sent))).toEqual([
      "local:pin-b",
      "local:pin-a",
      "local:a2",
      "local:a1",
      "local:a3",
      "local:b1",
      "local:b2",
      "local:b3",
    ]);
    // Provider output, tools, renames, and reconnect snapshots can update/reorder shells.
    const streamed = sent.map((entry) => ({ ...entry, updatedAt: at(22) })).toReversed();
    expect(ids(tree(streamed))).toEqual(ids(tree(sent)));
    expect(ids(tree(streamed, { [a]: false }))).toEqual([
      "local:pin-b",
      "local:pin-a",
      "local:b1",
      "local:b2",
      "local:b3",
    ]);
    expect(ids(tree(streamed))).toEqual(ids(tree(sent)));
    expect(
      tree(sent).filter((item) => item.kind === "marker" && item.marker === "project-header"),
    ).toEqual(initial.filter((item) => item.kind === "marker" && item.marker === "project-header"));
  });
});
