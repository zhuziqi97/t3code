import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { createI18n } from "./i18n/index.ts";

import {
  buildTraitsTriggerDisplay,
  getDescriptorStringValue,
  getPromptControlledTraits,
  getTraitSelectChange,
} from "./modelTraits.ts";

it("persists Codex access only when chosen in the shared model options", () => {
  const access = {
    id: "cyberAccessProgram",
    type: "select",
    label: "Cyber Access",
    currentValue: "daybreakBlue",
    options: [
      { id: "standard", label: "Standard" },
      { id: "daybreakBlue", label: "Daybreak Blue", isDefault: true },
    ],
  } satisfies ProviderOptionDescriptor;
  const effort = {
    id: "reasoningEffort",
    type: "select",
    label: "Reasoning",
    options: [
      { id: "low", label: "Low" },
      { id: "high", label: "High" },
    ],
  } satisfies ProviderOptionDescriptor;
  const descriptors = [effort, access];
  const traits = { descriptors, ...getPromptControlledTraits(descriptors, "") };
  const context = { driver: "codex" };
  expect(getTraitSelectChange(traits, effort, "", "high", context)?.modelOptions).toEqual([
    { id: "reasoningEffort", value: "high" },
  ]);
  const explicit = getTraitSelectChange(traits, access, "", "daybreakBlue", context)?.modelOptions;
  expect(explicit).toEqual([{ id: "cyberAccessProgram", value: "daybreakBlue" }]);
  expect(
    getTraitSelectChange(traits, effort, "", "high", { ...context, selections: explicit })
      ?.modelOptions,
  ).toEqual([
    { id: "reasoningEffort", value: "high" },
    { id: "cyberAccessProgram", value: "daybreakBlue" },
  ]);
  expect(
    getTraitSelectChange(traits, effort, "", "high", { driver: "acpRegistry" })?.modelOptions,
  ).toEqual([
    { id: "reasoningEffort", value: "high" },
    { id: "cyberAccessProgram", value: "daybreakBlue" },
  ]);
});

describe("buildTraitsTriggerDisplay", () => {
  it.each([
    { currentValue: undefined, defaultValue: undefined, value: null, label: "Thinking" },
    { currentValue: undefined, defaultValue: "high", value: "high", label: "High" },
    { currentValue: "low", defaultValue: undefined, value: "low", label: "Low" },
    { currentValue: "max", defaultValue: "high", value: "max", label: "Max" },
    { id: "effort", currentValue: undefined, defaultValue: undefined, value: null, label: "" },
  ])("labels Pi thinking without inventing a selection: $label ($value)", (input) => {
    const descriptor: Extract<ProviderOptionDescriptor, { type: "select" }> = {
      id: input.id ?? "thinking",
      label: "Thinking",
      type: "select",
      options: ["low", "high", "max"].map((id) => ({
        id,
        label: id[0]!.toUpperCase() + id.slice(1),
        ...(id === input.defaultValue ? { isDefault: true } : {}),
      })),
      ...(input.currentValue ? { currentValue: input.currentValue } : {}),
    };

    const traits = {
      descriptors: [descriptor],
      primarySelectDescriptorId: descriptor.id,
      ultrathinkPromptControlled: false,
    };
    expect(buildTraitsTriggerDisplay(traits).label).toBe(input.label);
    const t = createI18n().getFixedT("zh");
    expect(buildTraitsTriggerDisplay(traits, t).label).toBe(
      input.label === "Thinking" ? "思考" : input.label,
    );
    expect(getDescriptorStringValue(descriptor)).toBe(input.value);
  });
});
