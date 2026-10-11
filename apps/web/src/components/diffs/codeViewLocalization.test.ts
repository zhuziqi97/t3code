// @vitest-environment jsdom
import {
  DiffHunksRenderer,
  getSharedHighlighter,
  parseDiffFromFile,
  parsePatchFiles,
} from "@pierre/diffs";
import { TextDocument } from "@pierre/diffs/edit";
import { createI18n } from "@t3tools/client-runtime/i18n";
import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";

import { diffViewerLabels } from "./diffViewerLabels";

const panelUrl = new URL("./editor/searchPanel.js", import.meta.resolve("@pierre/diffs"));
type SearchWidget = {
  setLabels(labels: ReturnType<typeof diffViewerLabels> | undefined): void;
  cleanup(): void;
};
const { SearchPanelWidget } = (await import(/* @vite-ignore */ panelUrl.href)) as {
  SearchPanelWidget: new (options: {
    textDocument: TextDocument;
    containerElement: HTMLElement;
    defaultQuery: string;
    allowReplace?: boolean;
    uiLabels?: ReturnType<typeof diffViewerLabels>;
    scrollToMatch(range: [number, number]): void;
    applyReplace(edits: Array<{ start: number; end: number; text: string }>): void;
    onUpdate(matches: [number, number][]): [number, number] | undefined;
    onClose(): void;
  }) => SearchWidget;
};

const i18n = createI18n();
const en = diffViewerLabels(i18n.getFixedT("en"));
const zh = diffViewerLabels(i18n.getFixedT("zh"));
const widgets: SearchWidget[] = [];
const renderers: DiffHunksRenderer[] = [];

beforeAll(async () => {
  await getSharedHighlighter({ themes: ["pierre-dark"], langs: ["text"] });
});
afterEach(() => {
  for (const widget of widgets.splice(0)) widget.cleanup();
  for (const renderer of renderers.splice(0)) renderer.cleanUp();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function makeRenderer(labels = en) {
  const renderer = new DiffHunksRenderer({
    theme: "pierre-dark",
    diffStyle: "unified",
    expansionLineCount: 2,
    uiLabels: labels,
  });
  renderers.push(renderer);
  return renderer;
}
function renderDiff(renderer: DiffHunksRenderer, diff: ReturnType<typeof parseDiffFromFile>) {
  const result = renderer.renderDiff(diff);
  expect(result).toBeDefined();
  const container = document.createElement("div");
  container.innerHTML = renderer.renderFullHTML(result!);
  return { result: result!, container };
}
function searchInput() {
  return document.querySelector<HTMLInputElement>("input[data-search]")!;
}
function input(value: string) {
  searchInput().value = value;
  searchInput().dispatchEvent(new Event("input", { bubbles: true }));
}
function button(label: string) {
  const found = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(found, label).not.toBeNull();
  return found!;
}
function makeWidget(labels: ReturnType<typeof diffViewerLabels> | null = en, allowReplace = false) {
  // Flush only the widget's first-frame callback; matching uses the real TextDocument.
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
  const documentText = new TextDocument(
    "raw.txt",
    "Raw name 原文\nRaw name 原文\nraw names 原文\n",
  );
  const anchor = document.createElement("pre");
  document.body.append(anchor);
  const scrollToMatch = vi.fn();
  const onClose = vi.fn();
  const widget = new SearchPanelWidget({
    textDocument: documentText,
    containerElement: anchor,
    defaultQuery: "",
    allowReplace,
    ...(labels ? { uiLabels: labels } : {}),
    scrollToMatch,
    applyReplace: (edits) => {
      documentText.applyEdits(
        edits.map((edit) => ({
          range: {
            start: documentText.positionAt(edit.start),
            end: documentText.positionAt(edit.end),
          },
          newText: edit.text,
        })),
      );
    },
    onUpdate: (matches) => matches[0],
    onClose,
  });
  widgets.push(widget);
  return { widget, documentText, scrollToMatch, onClose };
}

it("uses renderer-owned counts and preserves raw code when labels change", () => {
  const lines = Array.from({ length: 50 }, (_, index) => `Raw line ${index + 1} 原文\n`);
  const changed = [...lines];
  changed[10] = "Changed line 11 原文\n";
  changed[40] = "Changed line 41 原文\n";
  const diff = parseDiffFromFile(
    { name: "raw.txt", contents: lines.join("") },
    { name: "raw.txt", contents: changed.join("") },
  );
  const renderer = makeRenderer();
  const english = renderDiff(renderer, diff);
  expect(english.container.textContent).toContain("unmodified lines");
  renderer.setOptions({ ...renderer.options, uiLabels: zh });
  const chinese = renderDiff(renderer, diff);
  expect(chinese.container.textContent).toContain("行未修改的内容");
  expect(chinese.container.textContent).toContain("展开全部上下文");
  expect(chinese.container.querySelector('[aria-label="向上展开上下文"]')).not.toBeNull();
  expect(chinese.container.querySelector('[aria-label="向下展开上下文"]')).not.toBeNull();
  expect(chinese.result.hunkData).toEqual(english.result.hunkData);
  expect(chinese.result.rowCount).toBe(english.result.rowCount);
  expect(chinese.container.textContent).toContain("Changed line 11 原文");
  expect(diff.additionLines).toEqual(changed);
});

it("translates unknown trailing context without inventing a line count", () => {
  const diff = parsePatchFiles(`diff --git a/raw.txt b/raw.txt
--- a/raw.txt
+++ b/raw.txt
@@ -1 +1 @@
-Raw before 原文
+Raw after 原文
`)[0]!.files[0]!;
  const renderer = makeRenderer(zh);
  renderer.setOptions({
    ...renderer.options,
    loadDiffFiles: async () => ({
      oldFile: { name: "raw.txt", contents: "Raw before 原文\n" },
      newFile: { name: "raw.txt", contents: "Raw after 原文\n" },
    }),
  });
  const { container, result } = renderDiff(renderer, diff);
  expect(container.textContent).toContain("可能还有更多未修改的上下文");
  expect(result.hunkData.some((hunk) => !hunk.lineCountKnown)).toBe(true);
});

it("keeps the search query, active match, and flags when switching labels", async () => {
  const { widget, documentText, scrollToMatch } = makeWidget();
  await Promise.resolve();
  input("name");
  button("Match case").click();
  button("Match whole word").click();
  button("Use regular expression").click();
  button("Next").click();
  expect(document.querySelector("[data-matches]")?.textContent).toBe("2 of 2");
  widget.setLabels(zh);
  expect(searchInput().value).toBe("name");
  expect(searchInput().getAttribute("aria-label")).toBe("搜索代码");
  expect(document.querySelector("[data-matches]")?.textContent).toBe("2 / 2");
  expect(button("区分大小写").getAttribute("aria-pressed")).toBe("true");
  expect(button("全字匹配").getAttribute("aria-pressed")).toBe("true");
  expect(button("使用正则表达式").getAttribute("aria-pressed")).toBe("true");
  const previousCalls = scrollToMatch.mock.calls.length;
  button("上一个匹配项").click();
  expect(scrollToMatch.mock.calls).toHaveLength(previousCalls + 1);
  expect(document.querySelector("[data-matches]")?.textContent).toBe("1 / 2");
  expect(documentText.getText()).toBe("Raw name 原文\nRaw name 原文\nraw names 原文\n");
});

it("uses Chinese empty results and keeps the read-only panel in find mode", async () => {
  const { onClose } = makeWidget(zh);
  await Promise.resolve();
  input("nothing 原文");
  expect(document.querySelector("[data-matches]")?.textContent).toBe("无匹配结果");
  expect(button("上一个匹配项").disabled).toBe(true);
  expect(document.querySelector<HTMLElement>("[data-search-grid]")?.dataset.mode).toBe("find");
  button("关闭搜索").click();
  expect(onClose).toHaveBeenCalledOnce();
  expect(document.querySelector("[data-search-panel]")).toBeNull();
});

it("keeps replacement text and replaces the selected occurrence after a language switch", async () => {
  const { widget, documentText } = makeWidget(en, true);
  await Promise.resolve();
  input("name");
  searchInput().dispatchEvent(
    new KeyboardEvent("keydown", { key: "f", code: "KeyF", ctrlKey: true, altKey: true }),
  );
  expect(document.querySelector<HTMLElement>("[data-search-grid]")?.dataset.mode).toBe("replace");
  const replacement = document.querySelector<HTMLInputElement>("input[data-replace]")!;
  replacement.value = "replacement 原文";
  replacement.dispatchEvent(new Event("input", { bubbles: true }));
  widget.setLabels(zh);
  expect(replacement.value).toBe("replacement 原文");
  button("替换").click();
  expect(documentText.getText()).toBe("Raw replacement 原文 原文\nRaw name 原文\nraw names 原文\n");
});

it("retains the package's English defaults when a host supplies no labels", async () => {
  makeWidget(null);
  await Promise.resolve();
  expect(searchInput().placeholder).toBe("Search");
  expect(document.querySelector("[data-matches]")?.textContent).toBe("No results");
  input("name");
  expect(document.querySelector("[data-matches]")?.textContent).toBe("1 of 3");
  expect(button("Match Case")).not.toBeNull();
});
