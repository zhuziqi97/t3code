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

it("translates reasoning titles while preserving native strengths and request values", () => {
  const t = createI18n().getFixedT("zh");
  for (const label of ["Reasoning", "Reasoning effort", "Effort"]) {
    expect(formatProviderOptionName({ ...reasoning, label }, t)).toBe("思考强度");
    expect(formatProviderOptionName({ ...reasoning, label }, createI18n().getFixedT("en"))).toBe(
      label,
    );
  }
  expect(getLocalizedProviderOptionCurrentLabel(reasoning, t)).toBe("Medium");
  for (const label of ["Low", "Medium", "High", "Extra High", "Max", "Ultra"]) {
    expect(formatProviderOptionChoiceLabel(reasoning, { id: label, label }, t)).toBe(label);
  }
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
  expect(selection).toEqual({
    instanceId: "raw-instance",
    model: "raw-model",
    options: [{ id: "reasoningEffort", value: "xhigh" }],
  });
  expect(reasoning.currentValue).toBe("medium");
});

it("uses ACP thought_level for arbitrary IDs without treating every native option as a strength", () => {
  const t = createI18n().getFixedT("zh");
  const descriptor = {
    ...reasoning,
    id: "custom-depth",
    category: "thought_level",
    currentValue: "native-normal",
    options: [{ id: "native-normal", label: "Normal" }],
  };
  expect(formatProviderOptionName(descriptor, t)).toBe("思考强度");
  expect(formatProviderOptionChoiceLabel(descriptor, descriptor.options[0]!, t)).toBe("Normal");
  expect(getLocalizedProviderOptionCurrentLabel(descriptor, t)).toBe("Normal");
  const mode = { ...descriptor, label: "Agent", category: "mode" };
  expect(getLocalizedProviderOptionCurrentLabel(mode, t)).toBe("普通");
});

it("translates service tier menu choices and selected values in both languages", async () => {
  const i18n = createI18n({ lng: "en" });
  const tier = {
    ...reasoning,
    id: "serviceTier",
    label: "Service Tier",
    currentValue: "priority",
    options: [
      { id: "default", label: "Standard" },
      { id: "priority", label: "Fast" },
    ],
  };
  for (const language of ["en", "zh", "en"]) {
    await i18n.changeLanguage(language);
    const t = i18n.t;
    expect(formatProviderOptionName(tier, t)).toBe(language === "zh" ? "服务等级" : "Service Tier");
    expect(tier.options.map((option) => formatProviderOptionChoiceLabel(tier, option, t))).toEqual(
      language === "zh" ? ["标准", "快速"] : ["Standard", "Fast"],
    );
    expect(getLocalizedProviderOptionCurrentLabel(tier, t)).toBe(
      language === "zh" ? "快速" : "Fast",
    );
    expect(formatProviderOptionName(reasoning, t)).toBe(
      language === "zh" ? "思考强度" : "Reasoning",
    );
    expect(getLocalizedProviderOptionCurrentLabel(reasoning, t)).toBe("Medium");
  }
  expect(tier.currentValue).toBe("priority");
  expect(tier.options.map((option) => option.id)).toEqual(["default", "priority"]);
});

it("preserves custom labels, unknown option IDs and context sizes", () => {
  const t = createI18n().getFixedT("zh");
  expect(formatProviderOptionChoiceLabel(reasoning, { id: "medium", label: "My Medium" }, t)).toBe(
    "My Medium",
  );
  expect(formatProviderOptionName({ ...reasoning, label: "My Reasoning" }, t)).toBe("My Reasoning");
  const custom = { ...reasoning, id: "raw-option", label: "Custom option" };
  expect(getLocalizedProviderOptionCurrentLabel(custom, t)).toBe("Medium");
  expect(formatProviderOptionChoiceLabel(custom, { id: "standard", label: "My Standard" }, t)).toBe(
    "My Standard",
  );
  const context = {
    ...reasoning,
    id: "contextWindow",
    label: "Context Window",
    currentValue: "1m",
    options: [{ id: "1m", label: "1M" }],
  };
  expect(formatProviderOptionName(context, t)).toBe("上下文窗口");
  expect(getLocalizedProviderOptionCurrentLabel(context, t)).toBe("1M");
});

it("uses the native reported-default and unknown resolution", () => {
  const t = createI18n().getFixedT("zh");
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

it("translates boolean states and known guidance while preserving custom guidance", () => {
  const t = createI18n().getFixedT("zh");
  const thinking = {
    id: "thinking",
    label: "Thinking",
    type: "boolean" as const,
    currentValue: true,
  };
  expect(formatProviderOptionName(thinking, t)).toBe("思考");
  expect(getLocalizedProviderOptionCurrentLabel(thinking, t)).toBe("开启");
  expect(getLocalizedProviderOptionCurrentLabel({ ...thinking, currentValue: false }, t)).toBe(
    "关闭",
  );
  expect(
    getLocalizedProviderOptionCurrentLabel({ ...thinking, currentValue: undefined }, t),
  ).toBeUndefined();
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
