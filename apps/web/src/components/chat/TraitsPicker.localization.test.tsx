// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";

const state = vi.hoisted(() => ({ save: vi.fn(), prompt: vi.fn(), persist: vi.fn() }));
vi.mock("../../composerDraftStore", () => ({
  useComposerDraftStore: (
    select: (store: { setProviderModelOptions: typeof state.persist }) => unknown,
  ) => select({ setProviderModelOptions: state.persist }),
}));

import { changeLanguage } from "../../i18n";
import { TraitsPicker } from "./TraitsPicker";

let root: Root;
let container: HTMLDivElement;
const reasoning: ProviderOptionDescriptor = {
  id: "reasoningEffort",
  label: "Reasoning",
  type: "select",
  currentValue: "medium",
  options: [
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
  ],
};
function model(descriptors: ReadonlyArray<ProviderOptionDescriptor>): ServerProviderModel {
  return {
    slug: "raw-model",
    name: "Raw Model Name",
    isCustom: false,
    capabilities: { optionDescriptors: descriptors },
  };
}
const DEFAULT_MODELS = [model([reasoning])];
const EMPTY_OPTIONS: ReadonlyArray<ProviderOptionSelection> = [];
function Harness({
  provider = "codex",
  models = DEFAULT_MODELS,
  initialPrompt = "请保留 raw prompt content",
  initialOptions = EMPTY_OPTIONS,
}: {
  provider?: string;
  models?: ReadonlyArray<ServerProviderModel>;
  initialPrompt?: string;
  initialOptions?: ReadonlyArray<ProviderOptionSelection>;
}) {
  const [options, setOptions] = useState<ReadonlyArray<ProviderOptionSelection> | undefined>(
    initialOptions,
  );
  const [prompt, setPrompt] = useState(initialPrompt);
  return (
    <>
      <textarea aria-label="Raw prompt" readOnly value={prompt} />
      <TraitsPicker
        provider={ProviderDriverKind.make(provider)}
        instanceId={ProviderInstanceId.make("raw-personal")}
        models={models}
        model="raw-model"
        prompt={prompt}
        modelOptions={options}
        planModeEnabled
        onModelOptionsChange={(next) => {
          state.save(next);
          setOptions(next);
        }}
        onPromptChange={(next) => {
          state.prompt(next);
          setPrompt(next);
        }}
      />
    </>
  );
}
async function render(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => root.render(<Harness {...props} />));
}
function trigger(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.getAttribute("aria-label") === label,
  );
  expect(button, `trigger ${label}`).toBeDefined();
  return button!;
}
function radio(label: string) {
  const button = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
    (button) => button.textContent?.trim() === label,
  );
  expect(button, `choice ${label}`).toBeDefined();
  return button!;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function language(language: "en" | "zh") {
  await act(async () => {
    await changeLanguage(language);
  });
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
  HTMLElement.prototype.getAnimations = () => [];
  await changeLanguage("en");
  for (const mock of [state.save, state.prompt, state.persist]) mock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps the effort menu open across a language switch and submits the raw choice once", async () => {
  await render();
  await click(trigger("Medium"));
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  await language("zh");
  expect(document.body.textContent).toContain("推理强度");
  expect(document.body.textContent).toContain("默认");
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  expect(trigger("中")).toBeDefined();
  expect(state.save).not.toHaveBeenCalled();
  await click(radio("高"));
  expect(state.save).toHaveBeenCalledExactlyOnceWith([{ id: "reasoningEffort", value: "high" }]);
  expect(trigger("高")).toBeDefined();
  await language("en");
  expect(trigger("High")).toBeDefined();
  expect(container.querySelector("textarea")?.value).toBe("请保留 raw prompt content");
  expect(state.prompt).not.toHaveBeenCalled();
  expect(state.persist).not.toHaveBeenCalled();
});

it("preserves the native Ultrathink prefix and removes it only when the user changes effort", async () => {
  const effort: ProviderOptionDescriptor = {
    ...reasoning,
    id: "effort",
    type: "select",
    promptInjectedValues: ["ultrathink"],
    options: [...reasoning.options, { id: "ultrathink", label: "Ultrathink" }],
  };
  await render({ provider: "claudeAgent", models: [model([effort])] });
  await language("zh");
  await click(trigger("中"));
  await click(radio("Ultrathink"));
  expect(container.querySelector("textarea")?.value).toBe("Ultrathink:\n请保留 raw prompt content");
  expect(trigger("Ultrathink")).toBeDefined();
  await language("en");
  await language("zh");
  expect(state.prompt).toHaveBeenCalledTimes(1);
  expect(state.save).not.toHaveBeenCalled();
  await click(trigger("Ultrathink"));
  await click(radio("高"));
  expect(container.querySelector("textarea")?.value).toBe("请保留 raw prompt content");
  expect(state.prompt).toHaveBeenCalledTimes(2);
  expect(state.save).toHaveBeenCalledExactlyOnceWith([{ id: "effort", value: "high" }]);
});

it("preserves custom metadata and context sizes while translating speed and boolean controls", async () => {
  const context: ProviderOptionDescriptor = {
    id: "contextWindow",
    label: "Context Window",
    type: "select",
    currentValue: "1m",
    options: [
      { id: "200k", label: "200k" },
      { id: "1m", label: "1M" },
    ],
  };
  const custom: ProviderOptionDescriptor = {
    ...reasoning,
    type: "select",
    label: "My Reasoning",
    options: [
      { id: "medium", label: "My Medium", description: "raw catalog guidance --keep-original" },
    ],
  };
  await render({
    models: [
      model([
        context,
        custom,
        { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: false },
      ]),
    ],
  });
  await language("zh");
  await click(trigger("1M · My Medium"));
  expect(document.body.textContent).toContain("上下文窗口");
  expect(document.body.textContent).toContain("My Reasoning");
  expect(document.body.textContent).toContain("raw catalog guidance --keep-original");
  expect(document.body.textContent).toContain("快速模式");
  await click(radio("开启"));
  expect(state.save.mock.calls[0]?.[0]).toEqual([
    { id: "contextWindow", value: "1m" },
    { id: "reasoningEffort", value: "medium" },
    { id: "fastMode", value: true },
  ]);
  expect(trigger("1M · My Medium 快速")).toBeDefined();
  await language("en");
  expect(trigger("1M · My Medium Fast")).toBeDefined();
  expect(state.save).toHaveBeenCalledTimes(1);
});

it("keeps unavailable OpenCode saved values read-only and verbatim", async () => {
  await render({
    provider: "opencode",
    models: [],
    initialOptions: [
      { id: "variant", value: "max" },
      { id: "customTrait", value: "My custom selection" },
    ],
  });
  await click(trigger("max · My custom selection"));
  await language("zh");
  expect(document.body.textContent).toContain("推理强度");
  expect(document.body.textContent).toContain("My custom selection");
  expect(document.querySelector('[role="menuitemradio"]')).toBeNull();
  expect(trigger("max · My custom selection")).toBeDefined();
  expect(state.save).not.toHaveBeenCalled();
});
