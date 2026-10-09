// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { createModelCapabilities, type CustomModelDefinition } from "@t3tools/shared/model";

import { changeLanguage } from "../../i18n";
import { CustomModelEditor } from "./CustomModelEditor";
import { ProviderModelsSection } from "./ProviderModelsSection";

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.unstubAllGlobals();
});
const render = async (element: ReactNode) => act(async () => root.render(element));
const switchLanguage = async (language: "en" | "zh") => act(async () => changeLanguage(language));
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
const click = async (element: HTMLElement) => act(async () => element.click());
const type = async (element: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
const onChange = vi.fn();
const onFavoriteModelsChange = vi.fn();
const models = [
  { slug: "raw/builtin-model", name: "Provider Model", isCustom: false, capabilities: null },
];
const modelSection = () => (
  <ProviderModelsSection
    instanceId={ProviderInstanceId.make("controlled-provider")}
    driverKind={ProviderDriverKind.make("claudeAgent")}
    models={models}
    customModels={[]}
    canManageCustomModels
    hiddenModels={[]}
    favoriteModels={[]}
    modelOrder={[]}
    onChange={onChange}
    onHiddenModelsChange={vi.fn()}
    onFavoriteModelsChange={onFavoriteModelsChange}
    onModelOrderChange={vi.fn()}
  />
);

it("keeps a custom model draft and submits its original ID after switching languages", async () => {
  onChange.mockReset();
  onFavoriteModelsChange.mockReset();
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
  expect(onFavoriteModelsChange).toHaveBeenCalledExactlyOnceWith(["raw/builtin-model"]);
  await click(button("添加"));
  expect(onChange).toHaveBeenCalledExactlyOnceWith([
    { slug: "vendor/custom-model", name: "vendor/custom-model", capabilities: null },
  ]);
});

it("retranslates a duplicate-model error without retrying or changing the entered ID", async () => {
  onChange.mockReset();
  await render(modelSection());
  await click(button("Add custom model"));
  await type(input("Model ID"), "raw/builtin-model");
  await click(button("Add"));
  expect(container.textContent).toContain("That model is already built in.");
  await switchLanguage("zh");
  expect(container.textContent).toContain("此模型已包含在内置模型中。");
  expect(input("模型 ID").value).toBe("raw/builtin-model");
  expect(onChange).not.toHaveBeenCalled();
});

it("keeps custom names and option values while translating validation and saving", async () => {
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
