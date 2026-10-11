// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { ComposerPromptEditorProps } from "../ComposerPromptEditor";

const state = vi.hoisted(() => ({
  editorRef: null as ComposerPromptEditorProps["editorRef"] | null,
}));
vi.mock("../ComposerPromptEditor", async (original) => {
  const actual = await original<typeof import("../ComposerPromptEditor")>();
  return {
    ...actual,
    ComposerPromptEditor: (props: ComposerPromptEditorProps) => {
      state.editorRef = props.editorRef;
      return <actual.ComposerPromptEditor {...props} />;
    },
  };
});

import { changeLanguage } from "../../i18n";
import { PromptFontPreview } from "./SettingsFontPreviews";
let root: Root;
let container: HTMLDivElement;
const previousRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
const previousBounds = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  const rectangle = new DOMRect(0, 0, 1, 1);
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [rectangle],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => rectangle,
  });
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  state.editorRef = null;
  await changeLanguage("en");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (previousRects) Object.defineProperty(Range.prototype, "getClientRects", previousRects);
  else Reflect.deleteProperty(Range.prototype, "getClientRects");
  if (previousBounds)
    Object.defineProperty(Range.prototype, "getBoundingClientRect", previousBounds);
  else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
});

it("updates the untouched sample in the actual editor without translating its skill and file links", async () => {
  await act(async () => root.render(<PromptFontPreview />));
  const editor = container.querySelector('[contenteditable="true"]')!;
  await act(async () => changeLanguage("zh"));
  expect(container.querySelector('[contenteditable="true"]')).toBe(editor);
  expect(editor.getAttribute("aria-label")).toBe("提示词字体预览");
  const snapshot = state.editorRef!.current!.readSnapshot();
  expect(snapshot.value).toContain("使用 $frontend-design 修复");
  expect(snapshot.value).toContain(
    "[surface.test.ts](apps/web/src/terminal/ghostty/surface.test.ts)",
  );
  expect(snapshot.value).toContain(
    "[SettingsPanels.tsx](apps/web/src/components/settings/SettingsPanels.tsx)",
  );
});

it("keeps an edited preview and cursor when switching language", async () => {
  await act(async () => root.render(<PromptFontPreview />));
  const editor = container.querySelector<HTMLElement>('[contenteditable="true"]')!;
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: {
      types: ["text/plain"],
      files: [],
      getData: (type: string) => (type === "text/plain" ? " Keep MY-PROJECT unchanged." : ""),
    },
  });
  await act(async () => {
    editor.focus();
    editor.dispatchEvent(paste);
  });
  const before = state.editorRef!.current!.readSnapshot();
  expect(before.value).toContain("Keep MY-PROJECT unchanged.");
  await act(async () => changeLanguage("zh"));
  expect(state.editorRef!.current!.readSnapshot()).toEqual(before);
  expect(editor.getAttribute("aria-label")).toBe("提示词字体预览");
});

it("does not treat moving the sample cursor as editing its content", async () => {
  await act(async () => root.render(<PromptFontPreview />));
  await act(async () => state.editorRef!.current!.focusAt(10));
  expect(state.editorRef!.current!.readSnapshot().cursor).toBe(10);
  await act(async () => changeLanguage("zh"));
  expect(state.editorRef!.current!.readSnapshot().value).toContain("使用 $frontend-design 修复");
});
