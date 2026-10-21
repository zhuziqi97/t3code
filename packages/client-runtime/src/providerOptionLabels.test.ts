import { expect, it } from "vite-plus/test";
import { ProviderInstanceId, type ProviderOptionDescriptor } from "@t3tools/contracts";
import { createI18n } from "./i18n/index.ts";
import { getProviderOptionDescriptors } from "@t3tools/shared/model";
import {
  formatProviderOptionChoiceLabel,
  formatProviderOptionDescription,
  formatProviderOptionName,
  getLocalizedProviderOptionCurrentLabel,
} from "./providerOptionLabels.ts";

const t = createI18n().getFixedT("zh");
const reasoning: Extract<ProviderOptionDescriptor, { type: "select" }> = {
  id: "reasoningEffort",
  label: "Reasoning",
  type: "select",
  currentValue: "medium",
  options: [
    { id: "medium", label: "Medium", isDefault: true },
    { id: "xhigh", label: "Extra High" },
  ],
};
it("preserves native reasoning labels and raw values in a Chinese interface", () => {
  expect(formatProviderOptionName(reasoning, t)).toBe("Reasoning");
  expect(getLocalizedProviderOptionCurrentLabel(reasoning, t)).toBe("Medium");
  const selection = {
    instanceId: ProviderInstanceId.make("raw-instance"),
    model: "raw-model",
    options: [{ id: "reasoningEffort", value: "xhigh" }],
  };
  const resolved = getProviderOptionDescriptors({
    caps: { optionDescriptors: [reasoning] },
    selections: selection.options,
  })[0]!;
  expect(getLocalizedProviderOptionCurrentLabel(resolved, t, selection)).toBe("Extra High");
  expect(selection.options[0]?.value).toBe("xhigh");
  expect(reasoning.currentValue).toBe("medium");
});
it("preserves custom labels, unknown option ids and context sizes", () => {
  expect(formatProviderOptionChoiceLabel(reasoning, { id: "medium", label: "My Medium" }, t)).toBe(
    "My Medium",
  );
  expect(formatProviderOptionChoiceLabel(reasoning, { id: "raw-choice", label: "Medium" }, t)).toBe(
    "Medium",
  );
  expect(formatProviderOptionName({ ...reasoning, label: "My Reasoning" }, t)).toBe("My Reasoning");
  const custom = { ...reasoning, id: "raw-option" };
  expect(getLocalizedProviderOptionCurrentLabel(custom, t)).toBe("Medium");
  const context = {
    ...reasoning,
    id: "contextWindow",
    label: "Context Window",
    currentValue: "1m",
    options: [{ id: "1m", label: "1M" }],
  };
  expect(formatProviderOptionName(context, t)).toBe("Context Window");
  expect(getLocalizedProviderOptionCurrentLabel(context, t)).toBe("1M");
});
it("uses the native reported-default and unknown resolution", () => {
  const descriptor = {
    ...reasoning,
    id: "variant",
    currentValue: "",
    options: [{ id: "thinking", label: "Thinking" }],
  };
  const selection = {
    instanceId: ProviderInstanceId.make("opencode"),
    model: "raw-model",
    options: [],
  };
  expect(getLocalizedProviderOptionCurrentLabel(descriptor, t, selection)).toBe("未知");
  expect(
    getLocalizedProviderOptionCurrentLabel(descriptor, t, selection, {
      ...selection,
      options: [{ id: "variant", value: "default" }],
    }),
  ).toBe("默认");
  expect(
    getLocalizedProviderOptionCurrentLabel({ ...reasoning, currentValue: "", options: [] }, t),
  ).toBeUndefined();
});
it("preserves native speed and boolean labels while translating T3-owned descriptions", () => {
  const speed = {
    ...reasoning,
    id: "serviceTier",
    currentValue: "ultrafast",
    options: [{ id: "ultrafast", label: "Ultrafast" }],
  };
  expect(getLocalizedProviderOptionCurrentLabel(speed, t)).toBe("Ultrafast");
  const thinking = {
    id: "thinking",
    label: "Thinking",
    type: "boolean" as const,
    currentValue: true,
  };
  expect(formatProviderOptionName(thinking, t)).toBe("Thinking");
  expect(getLocalizedProviderOptionCurrentLabel(thinking, t)).toBe("On");
  expect(formatProviderOptionDescription("Even faster, more expensive", t)).toBe(
    "速度更快，费用更高",
  );
  expect(formatProviderOptionDescription("2x speed, increased usage", t)).toBe(
    "速度提升至 2 倍，用量增加",
  );
  expect(formatProviderOptionDescription("raw provider guidance --keep-original", t)).toBe(
    "raw provider guidance --keep-original",
  );
});
