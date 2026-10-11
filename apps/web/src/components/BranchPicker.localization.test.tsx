// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnvironmentId, type VcsRef } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const baseState = vi.hoisted(() => ({
  refs: [] as VcsRef[],
  pending: true,
  error: null as string | null,
  data: null as { nextCursor: string | null; totalCount: number } | null,
}));
vi.mock("../state/queries", () => ({
  usePaginatedBranches: () => ({
    refs: baseState.refs,
    isPending: baseState.pending,
    error: baseState.error,
    data: baseState.data,
    isFetchingNextPage: false,
    loadNext: () => undefined,
  }),
}));
vi.mock("../state/query", () => ({ useEnvironmentQuery: () => ({ data: null }) }));
vi.mock("../state/vcs", () => ({ vcsEnvironment: { listRefs: () => null } }));

// Layout is exercised in the real clients; keep DOM interactions independent of virtual measurements.
vi.mock("@legendapp/list/react", () => ({
  LegendList: ({
    data,
    renderItem,
  }: {
    data: string[];
    renderItem: (input: { item: string; index: number }) => React.ReactNode;
  }) => (
    <div>
      {data.map((item, index) => (
        <div key={item}>{renderItem({ item, index })}</div>
      ))}
    </div>
  ),
}));
import { changeLanguage } from "../i18n";
import { BranchPicker, BranchPickerRefItem } from "./BranchPicker";
import { WorktreeBaseBranchPicker } from "./WorktreeBaseBranchPicker";
import { ComboboxTrigger } from "./ui/combobox";

const refs: VcsRef[] = [
  { name: "main", current: true, isDefault: true, worktreePath: "/work/project" },
  { name: "feature/原文", current: false, isDefault: false, worktreePath: "/work/other" },
  { name: "origin/cloud", current: false, isDefault: false, isRemote: true, worktreePath: null },
  { name: "default-raw", current: false, isDefault: true, worktreePath: null },
];
const selected = vi.fn();
const originChanged = vi.fn();
function Harness() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(true);
  const [origin, setOrigin] = useState(false);
  const items = refs.map((ref) => ref.name);
  const filteredItems = items.filter((name) => name.includes(query));
  const select = (name: string) => {
    selected(name);
    setOpen(false);
  };
  return (
    <BranchPicker
      items={items}
      filteredItems={filteredItems}
      value="main"
      query={query}
      resultsQuery={query}
      onQueryChange={setQuery}
      open={open}
      onOpenChange={setOpen}
      onSelectItem={select}
      hasNextPage={false}
      isFetchingNextPage={false}
      onLoadNext={() => undefined}
      statusText={null}
      originControl={{
        checked: origin,
        onCheckedChange: (checked) => {
          originChanged(checked);
          setOrigin(checked);
        },
      }}
      popupProps={{}}
      renderItem={(name, index) => (
        <BranchPickerRefItem
          branch={refs.find((ref) => ref.name === name)!}
          projectCwd="/work/project"
          index={index}
          onClick={() => select(name)}
        />
      )}
    >
      <ComboboxTrigger>Pick branch</ComboboxTrigger>
    </BranchPicker>
  );
}
let root: Root;
let container: HTMLDivElement;
function input() {
  return document.querySelector<HTMLInputElement>("input[aria-label]")!;
}
async function search(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(baseState, { refs: [], pending: true, error: null, data: null });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  await changeLanguage("en");
});

it("keeps the typed Git ref and origin choice across language changes and selects the raw ref once", async () => {
  for (const badge of ["current", "worktree", "remote", "default"])
    expect(document.body.textContent).toContain(badge);
  await act(async () => (document.querySelector('[role="switch"]') as HTMLButtonElement).click());
  await act(async () => {
    await changeLanguage("zh");
  });
  for (const badge of ["当前", "工作树", "远程", "默认"])
    expect(document.body.textContent).toContain(badge);
  await search("feature/原文");
  await act(async () => {
    await changeLanguage("en");
  });
  expect(input().value).toBe("feature/原文");
  expect(document.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  expect(originChanged).toHaveBeenCalledExactlyOnceWith(true);
  const option = [...document.querySelectorAll('[role="option"]')].find((e) =>
    e.textContent?.includes("feature/原文"),
  )!;
  await act(async () => (option as HTMLElement).click());
  expect(selected).toHaveBeenCalledExactlyOnceWith("feature/原文");
});

it("updates the empty search and accessible input without resetting the query", async () => {
  await search("missing-raw-ref");
  expect(document.body.textContent).toContain("No refs found.");
  await act(async () => {
    await changeLanguage("zh");
  });
  expect(document.body.textContent).toContain("未找到 Git 引用。");
  expect(input().value).toBe("missing-raw-ref");
  expect(input().getAttribute("aria-label")).toBe("搜索 Git 引用…");
  expect(selected).not.toHaveBeenCalled();
});

it("keeps the future worktree base while loading and translates its label and pagination state", async () => {
  const changeBase = vi.fn();
  const picker = () => (
    <WorktreeBaseBranchPicker
      environmentId={EnvironmentId.make("env-qa")}
      cwd="/work/project"
      value="default-raw"
      onValueChange={changeBase}
      startFromOrigin
      onStartFromOriginChange={originChanged}
    />
  );
  await act(async () => root.render(picker()));
  expect(container.textContent).toContain("From default-raw");
  await act(async () => container.querySelector("button")!.click());
  expect(document.body.textContent).toContain("Loading refs...");
  await act(async () => {
    await changeLanguage("zh");
  });
  expect(container.textContent).toContain("基于 default-raw");
  expect(document.body.textContent).toContain("正在加载 Git 引用…");
  Object.assign(baseState, { refs, pending: false, data: { nextCursor: "more", totalCount: 10 } });
  await act(async () => root.render(picker()));
  expect(container.textContent).toContain("基于 origin/default-raw");
  expect(document.body.textContent).toContain("已显示 4 / 10 个 Git 引用");
  baseState.error = "Network /tmp/原文 404";
  await act(async () => root.render(picker()));
  await act(async () => {
    await changeLanguage("en");
  });
  expect(document.body.textContent).toContain("Network /tmp/原文 404");
  expect(changeBase).not.toHaveBeenCalled();
  expect(originChanged).not.toHaveBeenCalled();
});
