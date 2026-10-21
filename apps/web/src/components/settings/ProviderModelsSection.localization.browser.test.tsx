import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../../test/render";
import { type ReactNode } from "react";

import { expect, it, vi } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { createModelCapabilities, type CustomModelDefinition } from "@t3tools/shared/model";

import { changeLanguage } from "../../i18n";
import { CustomModelEditor } from "./CustomModelEditor";
import { ProviderModelsSection } from "./ProviderModelsSection";

let root: Screen;
let container: HTMLDivElement;

const render = async (element: ReactNode) => await act(async () => root.rerender(element));
const switchLanguage = async (language: "en" | "zh") =>
  await act(async () => changeLanguage(language));
const button = (text: string) => {
  const target = [...container.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === text,
  );
  expect(target, text).toBeDefined();
  return target!;
};
const input = (label: string) => {
  const target = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  expect(target, label).not.toBeNull();
  return target!;
};
const click = async (element: HTMLElement) => await act(async () => element.click());
const type = async (element: HTMLInputElement, value: string) =>
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
const onChange = vi.fn();
const onFavoriteModelsChange = vi.fn();
const onToggleFavorite = vi.fn();
const models = [
  { slug: "raw/builtin-model", name: "Provider Model", isCustom: false, capabilities: null },
];
const modelSection = (customModels: ReadonlyArray<CustomModelDefinition> = []) => (
  <ProviderModelsSection
    instanceId={ProviderInstanceId.make("controlled-provider")}
    driverKind={ProviderDriverKind.make("claudeAgent")}
    models={models}
    customModels={customModels}
    canManageCustomModels
    hiddenModels={[]}
    favoriteModels={[]}
    modelOrder={[]}
    onChange={onChange}
    onHiddenModelsChange={vi.fn()}
    onFavoriteModelsChange={onFavoriteModelsChange}
    onToggleFavorite={onToggleFavorite}
    onModelOrderChange={vi.fn()}
  />
);

it("keeps a custom model draft and submits its original ID after switching languages", async () => {
  await using _lifecycle = await setupLifecycle();

  onChange.mockReset();
  onFavoriteModelsChange.mockReset();
  onToggleFavorite.mockReset();
  await render(modelSection());
  expect(container.textContent).toContain("1 model");
  await click(button("Add custom model"));
  await type(input("Model ID"), "vendor/custom-model");
  await switchLanguage("zh");
  expect(input("模型 ID").value).toBe("vendor/custom-model");
  expect(container.textContent).toContain("1 个模型");
  expect(container.textContent).toContain("Provider Model");
  await click(
    container.querySelector<HTMLButtonElement>('button[aria-label="收藏 Provider Model"]')!,
  );
  expect(onToggleFavorite).toHaveBeenCalledExactlyOnceWith("raw/builtin-model");
  await click(button("添加"));
  expect(onChange).toHaveBeenCalledExactlyOnceWith([
    { slug: "vendor/custom-model", capabilities: null },
  ]);
});

it("retranslates a duplicate-model error without retrying or changing the entered ID", async () => {
  await using _lifecycle = await setupLifecycle();

  onChange.mockReset();
  await render(modelSection([{ slug: "raw/builtin-model", capabilities: null }]));
  await click(button("Add custom model"));
  await type(input("Model ID"), "raw/builtin-model");
  await click(button("Add"));
  expect(container.textContent).toContain("That custom model is already saved.");
  await switchLanguage("zh");
  expect(container.textContent).toContain("此自定义模型已保存。");
  expect(input("模型 ID").value).toBe("raw/builtin-model");
  expect(onChange).not.toHaveBeenCalled();
});

it("keeps custom names and option values while translating validation and saving", async () => {
  await using _lifecycle = await setupLifecycle();

  const entry: CustomModelDefinition = {
    slug: "raw/custom-model",
    name: "User model name",
    capabilities: createModelCapabilities({
      optionDescriptors: [
        {
          type: "select",
          id: "rawOption",
          label: "User option name",
          options: [{ id: "raw-choice", label: "User choice name", isDefault: true }],
          currentValue: "raw-choice",
        },
      ],
    }),
  };
  const onSave = vi.fn();
  await render(
    <CustomModelEditor
      instanceId="controlled-provider"
      driverKind={null}
      entry={entry}
      builtInModels={[]}
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  );
  await type(input("Option id"), "");
  await click(button("Save"));
  expect(container.textContent).toContain("Option 1 needs an id.");
  await switchLanguage("zh");
  expect(container.textContent).toContain("请为参数 1 填写 ID。");
  expect(input("参数名称").value).toBe("User option name");
  expect(input("选项值").value).toBe("raw-choice");
  expect(input("选项名称").value).toBe("User choice name");
  expect(onSave).not.toHaveBeenCalled();
  await type(input("参数 ID"), "rawOption");
  await click(button("保存"));
  expect(onSave).toHaveBeenCalledExactlyOnceWith(entry);
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    await changeLanguage("en");
    vi.unstubAllGlobals();
  });

  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));

  renderStack = stack.move();
  return renderStack;
}
