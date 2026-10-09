// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => {
  Object.defineProperty(window, "queryLocalFonts", { value: () => [], configurable: true });
  return { query: vi.fn(), select: vi.fn(), toast: vi.fn() };
});
vi.mock("../../appearanceFonts", () => ({
  queryInstalledFontFamilies: state.query,
  isMonospaceFamily: (family: string) => family === "Raw Mono",
}));
vi.mock("../ui/toast", () => ({
  toastManager: { add: state.toast },
  stackedThreadToast: (value: unknown) => value,
}));
vi.mock("@legendapp/list/react", () => ({
  LegendList: ({
    data,
    renderItem,
  }: {
    data: string[];
    renderItem: (value: { item: string; index: number }) => ReactNode;
  }) => (
    <div>
      {data.map((item, index) => (
        <div key={item}>{renderItem({ item, index })}</div>
      ))}
    </div>
  ),
}));
import { changeLanguage } from "../../i18n";
import { FontFamilyPicker, discoverInstalledFonts } from "./FontFamilyPicker";

it("keeps font searches through a language change, rejects proportional fonts and selects raw families", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLanguage("en");
  state.query.mockResolvedValue({ status: "granted", families: ["Raw Mono", "Raw Proportional"] });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <FontFamilyPicker
          ariaLabel="controlled font picker"
          defaultFamily="Raw Mono"
          selectedFamily="Raw Mono"
          requireMonospace
          onSelect={state.select}
        />,
      ),
    );
    await act(async () => discoverInstalledFonts());
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="controlled font picker"]',
    )!;
    await act(async () => trigger.click());
    const search = document.querySelector<HTMLInputElement>('input[placeholder="Search fonts…"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        search,
        "Raw",
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => changeLanguage("zh"));
    expect(document.querySelector<HTMLInputElement>('input[placeholder="搜索字体…"]')!.value).toBe(
      "Raw",
    );
    expect(state.query).toHaveBeenCalledTimes(1);
    const choice = (text: string) =>
      [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (node) => node.textContent?.trim() === text,
      )!;
    await act(async () => choice("Raw Proportional").click());
    expect(state.select).not.toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: "“Raw Proportional”不是等宽字体" }),
    );
    await act(async () => trigger.click());
    await act(async () => choice("Raw Mono").click());
    expect(state.select).toHaveBeenCalledExactlyOnceWith("Raw Mono");
    expect(state.query).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(window, "queryLocalFonts");
    await changeLanguage("en");
    vi.unstubAllGlobals();
  }
});
