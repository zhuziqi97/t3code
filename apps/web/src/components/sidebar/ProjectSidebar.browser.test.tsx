import { DndContext, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import {
  presentThreadShell,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import * as DateTime from "effect/DateTime";
import { i18n } from "../../i18n";
import { buildSidebarProjectSnapshots } from "../../sidebarProjectGrouping";
import { useUiStateStore } from "../../uiStateStore";
import type { Project } from "../../types";
import {
  orderItemsByPreferredIds,
  sidebarListItemId,
  type SidebarListItem,
} from "../Sidebar.logic";
import { SidebarPointerSensor } from "../Sidebar.pointer";
import { buildProjectTreeList } from "./projectTree";
import { ProjectTreeLayout, type ProjectDragHandle } from "./ProjectTreeLayout";
import { useProjectDrag } from "./useProjectDrag";
import { useProjectThreadPages } from "./useProjectThreadPages";
import { ProjectThreadPageControls } from "./ProjectThreadPageControls";

const environmentId = EnvironmentId.make("sidebar-test");
function project(id: string): Project {
  return {
    environmentId,
    id: ProjectId.make(id),
    title: id,
    workspaceRoot: `/mock/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-10-21T00:00:00Z",
    updatedAt: "2026-10-21T00:00:00Z",
  };
}
const originalGroups = buildSidebarProjectSnapshots({
  projects: [project("A"), project("B")],
  settings: { sidebarProjectGroupingMode: "separate", sidebarProjectGroupingOverrides: {} },
  primaryEnvironmentId: environmentId,
  resolveEnvironmentLabel: () => null,
});
function threads() {
  return ["A", "B"].flatMap((projectId) =>
    Array.from({ length: 9 }, (_, i) => ({
      ...presentThreadShell(environmentId, {
        providerInstanceId: ProviderInstanceId.make("mock"),
        modelSelection: { instanceId: ProviderInstanceId.make("mock"), model: null },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        activeProviderThreadId: null,
        createdBy: "user",
        creationSource: "web",
        latestRunId: null,
        activeRunId: null,
        status: "idle",
        pendingRuntimeRequest: null,
        latestVisibleMessage: null,
        latestUserMessageAt: null,
        hasActionableProposedPlan: false,
        itemCount: 0,
        visibleItemCount: 0,
        forkedFrom: null,
        createdAt: DateTime.makeUnsafe("2026-10-21T00:00:00Z"),
        updatedAt: DateTime.makeUnsafe("2026-10-21T00:00:00Z"),
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
        lineage: {
          rootThreadId: ThreadId.make(`${projectId}${i}`),
          parentThreadId: null,
          relationshipToParent: null,
        },
        id: ThreadId.make(`${projectId}${i}`),
        projectId: ProjectId.make(projectId),
        title: `${projectId} thread ${i}`,
      }),
      lastVisitedAt: "2026-10-21T00:00:00Z",
      latestRun:
        i === 8
          ? {
              runId: RunId.make(`${projectId}-run`),
              status: "completed" as const,
              requestedAt: null,
              startedAt: null,
              completedAt: "2026-10-22T00:00:00Z",
              assistantMessageId: null,
            }
          : null,
    })),
  );
}
async function setup() {
  const stack = new AsyncDisposableStack();
  const previous = useUiStateStore.getState();
  const language = i18n.language;
  await i18n.changeLanguage("en");
  useUiStateStore.setState({
    projectOrder: [],
    threadLastVisitedAtById: {},
    projectExpandedById: {},
  });
  stack.defer(() => {
    useUiStateStore.setState(previous);
  });
  stack.defer(async () => {
    await i18n.changeLanguage(language);
  });
  return stack;
}
function Fixture(props: { threads: EnvironmentThreadShell[]; route?: string; draft?: boolean }) {
  const preferences = useUiStateStore((state) => state.projectOrder);
  const groups = orderItemsByPreferredIds({
    items: originalGroups,
    preferredIds: preferences,
    getId: (group) => group.projectKey,
    getPreferenceIds: (group) => group.memberProjects.map((member) => member.physicalProjectKey),
  });
  const pages = useProjectThreadPages({
    threads: props.threads,
    initialCount: 3,
    projectKeyByRef: new Map(
      groups.flatMap((group) =>
        group.memberProjectRefs.map(
          (ref) => [`${ref.environmentId}:${ref.projectId}`, group.projectKey] as const,
        ),
      ),
    ),
    routeThreadKey: props.route ?? null,
    isExpanded: () => true,
  });
  const items = buildProjectTreeList({
    groups,
    expandedById: {},
    pinned: [],
    active: pages.visible,
    working: [],
    workingAll: [],
    snoozed: [],
    snoozedAll: [],
    settled: [],
    settledAll: [],
    pageControls: new Set(
      groups
        .filter(
          (group) =>
            pages.hiddenByProject.has(group.projectKey) ||
            pages.expandedProjects.has(group.projectKey),
        )
        .map((group) => `active:${group.projectKey}`),
    ),
  });
  const drag = useProjectDrag(groups);
  const sensors = useSensors(
    useSensor(SidebarPointerSensor, { distance: 6, onAttach: () => {}, onFinish: () => {} }),
  );
  const renderItem = (item: SidebarListItem, handle?: ProjectDragHandle) => {
    const key = sidebarListItemId(item);
    if (item.kind === "thread")
      return (
        <li key={key}>
          {
            props.threads.find((thread) => `${thread.environmentId}:${thread.id}` === item.key)
              ?.title
          }
        </li>
      );
    if (item.marker === "project-header")
      return (
        <li key={key}>
          <button
            type="button"
            style={{ height: 36, width: 280 }}
            ref={handle?.setActivatorNodeRef}
            {...handle?.attributes}
            {...handle?.listeners}
          >
            Project {groups.find((group) => group.projectKey === item.projectKey)?.displayName}
          </button>
        </li>
      );
    if (item.marker === "active-more" && item.projectKey)
      return (
        <li key={key}>
          <ProjectThreadPageControls
            hiddenThreads={pages.hiddenByProject.get(item.projectKey) ?? []}
            pageSize={3}
            expanded={pages.expandedProjects.has(item.projectKey)}
            onMore={() => pages.showMore(item.projectKey!)}
            onLess={() => pages.showLess(item.projectKey!)}
          />
        </li>
      );
    return null;
  };
  return (
    <>
      <output data-testid="order">{groups.map((group) => group.displayName).join(",")}</output>
      <DndContext
        sensors={sensors}
        collisionDetection={drag.collisionDetection ?? closestCenter}
        onDragStart={(event) => drag.start(String(event.active.id))}
        onDragEnd={(event) =>
          drag.end(String(event.active.id), event.over ? String(event.over.id) : null)
        }
        onDragCancel={drag.cancel}
      >
        <ProjectTreeLayout
          items={items}
          projectKeys={groups.map((group) => group.projectKey)}
          dragDisabled={false}
          listRef={() => {}}
          renderItem={renderItem}
        >
          {props.draft ? <input aria-label="Draft message" defaultValue="Keep this draft" /> : null}
        </ProjectTreeLayout>
      </DndContext>
    </>
  );
}

it("reveals one project's history in batches and keeps hidden completion feedback until read", async () => {
  await using _setup = await setup();
  const source = threads();
  await using screen = await render(<Fixture threads={source} />);
  await expect.element(screen.getByText("A thread 2")).toBeVisible();
  expect(screen.container.textContent).not.toContain("A thread 3");
  const more = screen.getByRole("button", { name: /Show 3 more/ });
  await userEvent.click(more.first());
  await expect.element(screen.getByText("A thread 5")).toBeVisible();
  expect(screen.container.textContent).not.toContain("A thread 6");
  expect(screen.container.textContent).not.toContain("B thread 3");
  expect(screen.container.querySelectorAll('[aria-label="Unread turn result"]')).toHaveLength(2);
  await userEvent.click(screen.getByRole("button", { name: "Show less" }));
  await expect.element(screen.getByText("A thread 3")).not.toBeInTheDocument();
  await screen.rerender(
    <Fixture
      threads={source.map((thread) =>
        thread.id === "A8" ? { ...thread, lastVisitedAt: "2026-10-23T00:00:00Z" } : thread,
      )}
    />,
  );
  expect(screen.container.querySelectorAll('[aria-label="Unread turn result"]')).toHaveLength(1);
});

it("keeps a directly opened deep thread visible without expanding all history", async () => {
  await using _setup = await setup();
  await using screen = await render(<Fixture threads={threads()} route={`${environmentId}:A8`} />);
  await expect.element(screen.getByText("A thread 8")).toBeVisible();
  expect(screen.container.textContent).not.toContain("A thread 7");
  await userEvent.click(screen.getByRole("button", { name: /Show 3 more/ }).first());
  await userEvent.click(screen.getByRole("button", { name: "Show less" }));
  await expect.element(screen.getByText("A thread 8")).toBeVisible();
  await expect.element(screen.getByText("A thread 4")).not.toBeInTheDocument();
});

it("drags the whole project block, saves its order, and restores that order after remount", async () => {
  await using _setup = await setup();
  const source = threads();
  await using screen = await render(<Fixture threads={source} />);
  await userEvent.dragAndDrop(
    screen.getByRole("button", { name: "Project A" }),
    screen.getByRole("button", { name: "Project B" }),
  );
  await expect.element(screen.getByTestId("order")).toHaveTextContent("B,A");
  expect(useUiStateStore.getState().projectOrder).toEqual(
    originalGroups
      .toReversed()
      .flatMap((group) => group.memberProjects.map((member) => member.physicalProjectKey)),
  );
  await screen.rerender(<Fixture key="remounted" threads={source} />);
  await expect.element(screen.getByTestId("order")).toHaveTextContent("B,A");
  expect(
    [...screen.container.querySelectorAll("[data-project-block]")].map((node) =>
      node.getAttribute("data-project-block"),
    ),
  ).toEqual(originalGroups.toReversed().map((group) => group.projectKey));
});

it("keeps an editable draft mounted before the project groups while reordering", async () => {
  await using _setup = await setup();
  await using screen = await render(<Fixture threads={threads()} draft />);
  const draft = screen.getByRole("textbox", { name: "Draft message" });
  await expect.element(draft).toBeVisible();
  await userEvent.fill(draft, "Keep edited draft");
  await userEvent.dragAndDrop(
    screen.getByRole("button", { name: "Project A" }),
    screen.getByRole("button", { name: "Project B" }),
  );
  await expect.element(screen.getByTestId("order")).toHaveTextContent("B,A");
  await expect.element(draft).toHaveValue("Keep edited draft");
  expect(screen.container.querySelector('ul[role="presentation"]')?.firstElementChild).toBe(
    screen.container.querySelector('[aria-label="Draft message"]'),
  );
});
