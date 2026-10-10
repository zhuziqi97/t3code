// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PullRequestListFilters } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { changeLanguage, useTranslate } from "../../i18n";
import { PullRequestFiltersMenu, PullRequestSearchInput } from "./PullRequestListFilters";
import { PullRequestListEmptyState } from "./PullRequestListEmptyState";
import { PullRequestsUnavailableState } from "./PullRequestsUnavailableState";
import { PullRequestGlyph } from "./pullRequestIcons";

let root: Root;
let container: HTMLDivElement;
const changed = vi.fn();

function FiltersHarness() {
  const t = useTranslate();
  const [filters, setFilters] = useState<PullRequestListFilters>({ review: "approved" });
  return (
    <PullRequestFiltersMenu
      state="open"
      stateOptions={[
        { value: "open", label: t("pullRequest.state.open"), Icon: PullRequestGlyph.pullRequest },
      ]}
      onState={() => undefined}
      involvement="all"
      involvementOptions={[
        { value: "all", label: t("pullRequest.list.all"), Icon: PullRequestGlyph.pullRequest },
      ]}
      onInvolvement={() => undefined}
      filters={filters}
      onFilters={(next) => {
        changed(next);
        setFilters(next);
      }}
      host={undefined}
      hostOptions={[]}
      onHost={() => undefined}
      server={undefined}
      serverOptions={[]}
      onServer={() => undefined}
      projects={[]}
      projectId={undefined}
      projectEnvironmentId={undefined}
      unavailable={new Map()}
      onProject={() => undefined}
    />
  );
}

async function clickText(selector: string, text: string) {
  const element = [...document.querySelectorAll<HTMLElement>(selector)].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  expect(element, text).toBeDefined();
  await act(async () => element!.click());
}

beforeEach(async () => {
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
  changed.mockClear();
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  await changeLanguage("en");
});

it("keeps a typed host query when its input switches language", async () => {
  function SearchHarness() {
    const [query, setQuery] = useState("");
    return <PullRequestSearchInput value={query} onChange={setQuery} />;
  }
  await act(async () => root.render(<SearchHarness />));
  const input = container.querySelector("input")!;
  const query = 'label:"needs design" author:octocat 原文';
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => changeLanguage("zh"));
  expect(input.value).toBe(query);
  expect(input.getAttribute("aria-label")).toBe("搜索拉取请求");
  expect(input.placeholder).toContain("label:bug");
  await act(async () => changeLanguage("en"));
  expect(input.value).toBe(query);
});

it("changes an open filter menu and keeps the selected raw review value", async () => {
  await act(async () => root.render(<FiltersHarness />));
  await act(async () => container.querySelector("button")!.click());
  await clickText('[role="menuitem"]', "ReviewApproved");
  await act(async () => changeLanguage("zh"));
  const approved = [...document.querySelectorAll('[role="menuitemradio"]')].find(
    (element) => element.textContent?.trim() === "已批准",
  );
  expect(approved?.getAttribute("aria-checked")).toBe("true");
  expect(changed).not.toHaveBeenCalled();
  await clickText('[role="menuitemradio"]', "要求修改");
  expect(changed).toHaveBeenCalledExactlyOnceWith({ review: "changes-requested" });
  expect(container.textContent).toContain("筛选");
});

const emptyProps = {
  query: "",
  filtered: false,
  searching: false,
  hasProjects: true,
  canLoadMore: true,
  loadingMore: false,
  refreshing: false,
  onClearQuery: vi.fn(),
  onLoadMore: vi.fn(),
  onRefresh: vi.fn(),
};

it("keeps the actual query in an empty result and clears it through the translated action", async () => {
  const clear = vi.fn();
  await act(async () =>
    root.render(
      <PullRequestListEmptyState {...emptyProps} query="label:bug 原文" onClearQuery={clear} />,
    ),
  );
  await act(async () => changeLanguage("zh"));
  expect(container.textContent).toContain("没有匹配“label:bug 原文”的结果");
  await clickText("button", "清除搜索");
  expect(clear).toHaveBeenCalledOnce();
});

it("keeps loading controls disabled and enables the translated pagination action when ready", async () => {
  const load = vi.fn();
  await act(async () =>
    root.render(
      <PullRequestListEmptyState {...emptyProps} loadingMore refreshing onLoadMore={load} />,
    ),
  );
  await act(async () => changeLanguage("zh"));
  expect([...container.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
  expect(container.textContent).toContain("正在加载…");
  await act(async () =>
    root.render(<PullRequestListEmptyState {...emptyProps} onLoadMore={load} />),
  );
  await clickText("button", "加载更多拉取请求");
  expect(load).toHaveBeenCalledOnce();
});

it("translates retry without changing a server diagnostic or its host link", async () => {
  const retry = vi.fn();
  const url = "https://github.com/acme/raw/pulls?q=label%3Abug";
  await act(async () =>
    root.render(
      <PullRequestsUnavailableState
        error="Raw host diagnostic 原文"
        gitHubUrl={url}
        onRetry={retry}
      />,
    ),
  );
  await act(async () => changeLanguage("zh"));
  expect(container.textContent).toContain("无法加载拉取请求");
  expect(container.textContent).toContain("Raw host diagnostic 原文");
  expect(container.querySelector("a")?.href).toBe(url);
  await clickText("button", "重试");
  expect(retry).toHaveBeenCalledOnce();
});
