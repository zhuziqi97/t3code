import "~/index.css";
import { render } from "../../../test/render";
import {
  CodeView,
  DiffHunksRenderer,
  File,
  FileDiff,
  getSharedHighlighter,
  parseDiffFromFile,
  parsePatchFiles,
} from "@pierre/diffs";
import { Editor, TextDocument } from "@pierre/diffs/edit";
import { createI18n } from "@t3tools/client-runtime/i18n";
import { expect, it, vi } from "vite-plus/test";

import { diffViewerLabels } from "./diffViewerLabels";

import { SearchPanelWidget } from "../../../node_modules/@pierre/diffs/dist/editor/searchPanel.js";
type SearchWidget = Pick<SearchPanelWidget, "setLabels" | "cleanup">;

const i18n = createI18n();
const en = diffViewerLabels(i18n.getFixedT("en"));
const zh = diffViewerLabels(i18n.getFixedT("zh"));
const widgets: SearchWidget[] = [];
const renderers: DiffHunksRenderer[] = [];

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

it("uses renderer-owned counts and preserves raw code when labels change", async () => {
  await using _lifecycle = await setupLifecycle();

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

it("translates unknown trailing context without inventing a line count", async () => {
  await using _lifecycle = await setupLifecycle();

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
  await using _lifecycle = await setupLifecycle();

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
  await using _lifecycle = await setupLifecycle();

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
  await using _lifecycle = await setupLifecycle();

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
  await using _lifecycle = await setupLifecycle();

  makeWidget(null);
  await Promise.resolve();
  expect(searchInput().placeholder).toBe("Search");
  expect(document.querySelector("[data-matches]")?.textContent).toBe("No results");
  input("name");
  expect(document.querySelector("[data-matches]")?.textContent).toBe("1 of 3");
  expect(button("Match Case")).not.toBeNull();
});

const sourceFile = {
  name: "raw.txt",
  contents: "Raw name 原文\nRaw name 原文\nraw names 原文\n",
};

async function checkLiveSearchLabels(root: ShadowRoot, updateLabels: () => void) {
  const query = root.querySelector<HTMLInputElement>("input[data-search]")!;
  const press = (label: string) => {
    const target = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    expect(target, label).not.toBeNull();
    target.click();
    return target;
  };
  query.value = "name";
  query.dispatchEvent(new Event("input", { bubbles: true }));
  press("Match case");
  press("Match whole word");
  press("Use regular expression");
  // Await the panel's initial search through its observable result.
  await vi.waitFor(() => expect(root.querySelector("[data-matches]")?.textContent).toBe("1 of 2"));
  press("Next");
  expect(root.querySelector("[data-matches]")?.textContent).toBe("2 of 2");

  updateLabels();

  expect(root.querySelector("input[data-search]")).toBe(query);
  expect(query.value).toBe("name");
  expect(query.getAttribute("aria-label")).toBe("搜索代码");
  expect(root.querySelector("[data-matches]")?.textContent).toBe("2 / 2");
  for (const label of ["区分大小写", "全字匹配", "使用正则表达式"]) {
    expect(root.querySelector(`[aria-label="${label}"]`)?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  }
  press("上一个匹配项");
  expect(root.querySelector("[data-matches]")?.textContent).toBe("1 / 2");
  press("关闭搜索");
  expect(root.querySelector("[data-search-panel]")).toBeNull();
}

it.each(["file", "file-diff"] as const)(
  "updates %s options with its real Editor and an open search panel",
  async (type) => {
    await getSharedHighlighter({ themes: ["pierre-dark"], langs: ["text"] });
    await using screen = await render(null);
    using cleanup = new DisposableStack();
    const options = { theme: "pierre-dark", uiLabels: en, disableErrorHandling: true };
    const preview = (() => {
      if (type === "file") {
        const file = new File(options);
        cleanup.defer(() => file.cleanUp());
        file.render({ file: sourceFile, containerWrapper: screen.container });
        const editor = new Editor("file");
        editor.edit(file);
        return {
          setLabels: (uiLabels: typeof en) => file.setOptions({ ...file.options, uiLabels }),
          editor,
        };
      }
      const file = new FileDiff({ ...options, diffStyle: "unified" });
      cleanup.defer(() => file.cleanUp());
      file.render({
        fileDiff: parseDiffFromFile({ ...sourceFile, contents: "before\n" }, sourceFile),
        containerWrapper: screen.container,
      });
      const editor = new Editor("file-diff");
      editor.edit(file);
      return {
        setLabels: (uiLabels: typeof en) => file.setOptions({ ...file.options, uiLabels }),
        editor,
      };
    })();

    expect(() => preview.setLabels(en)).not.toThrow();
    const root = screen.container.querySelector("diffs-container")!.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('[contenteditable="true"]')).not.toBeNull());
    root.querySelector('[contenteditable="true"]')!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        bubbles: true,
        cancelable: true,
        metaKey: navigator.platform.includes("Mac"),
        ctrlKey: !navigator.platform.includes("Mac"),
      }),
    );
    await vi.waitFor(() => expect(root.querySelector("input[data-search]")).not.toBeNull());
    await checkLiveSearchLabels(root, () => preview.setLabels(zh));
    expect(preview.editor.getText()).toBe(sourceFile.contents);
  },
);

it("updates an open CodeView search through setOptions without resetting search state", async () => {
  await getSharedHighlighter({ themes: ["pierre-dark"], langs: ["text"] });
  await using screen = await render(null);
  using cleanup = new DisposableStack();
  const options = { theme: "pierre-dark", uiLabels: en, disableErrorHandling: true };
  const view = new CodeView(options);
  cleanup.defer(() => view.cleanUp());
  screen.container.style.height = "400px";
  screen.container.style.overflow = "auto";
  view.setup(screen.container);
  const fileDiff = parseDiffFromFile(null, sourceFile);
  view.setItems([{ id: "raw", type: "diff", fileDiff }]);
  view.openSearch();
  const host = view.getContainerElement()!.querySelector("[data-diffs-search]")!;
  await checkLiveSearchLabels(host.shadowRoot!, () =>
    view.setOptions({ ...options, uiLabels: zh }),
  );
  expect(fileDiff.additionLines.join("")).toBe(sourceFile.contents);
});

async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  stack.defer(async () => {
    for (const widget of widgets.splice(0)) widget.cleanup();
    for (const renderer of renderers.splice(0)) renderer.cleanUp();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  await getSharedHighlighter({ themes: ["pierre-dark"], langs: ["text"] });

  return stack.move();
}
