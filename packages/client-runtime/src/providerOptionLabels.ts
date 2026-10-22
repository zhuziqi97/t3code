import type { TFunction } from "i18next";
import type { ModelSelection, ProviderOptionDescriptor } from "@t3tools/contracts";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
} from "@t3tools/shared/model";

type LocalizableProviderOptionDescriptor = ProviderOptionDescriptor & {
  readonly category?: string;
};

const optionNameKeys = new Map([
  ["Reasoning", "provider.models.reasoning"],
  ["Reasoning effort", "chat.traits.reasoningEffort"],
  ["Effort", "chat.traits.name.effort"],
  ["Thinking", "chat.traits.name.thinking"],
  ["Fast Mode", "chat.traits.name.fastMode"],
  ["Fast mode", "provider.models.fastMode"],
  ["Service Tier", "chat.traits.name.serviceTier"],
  ["Context Window", "chat.traits.name.contextWindow"],
  ["Agent", "chat.traits.name.agent"],
]);

const optionChoiceKeys = new Map([
  ["Standard", "chat.traits.choice.standard"],
  ["Fast", "chat.traits.choice.fast"],
  ["Ultrafast", "chat.traits.choice.ultrafast"],
  ["Flex", "chat.traits.choice.flex"],
  ["Normal", "chat.traits.choice.normal"],
  ["Build", "chat.traits.choice.build"],
  ["Plan", "chat.traits.choice.plan"],
  ["On", "common.on"],
  ["Off", "common.off"],
]);

function isThoughtLevel(descriptor: LocalizableProviderOptionDescriptor): boolean {
  if (descriptor.category !== undefined) return descriptor.category === "thought_level";
  return (
    ["reasoningEffort", "effort", "thinking"].includes(descriptor.id) ||
    ["Reasoning", "Reasoning effort", "Effort", "Thinking"].includes(descriptor.label)
  );
}

export function formatProviderOptionName(
  descriptor: LocalizableProviderOptionDescriptor,
  t: TFunction,
): string {
  const key = optionNameKeys.get(descriptor.label);
  return key ? t(key) : descriptor.label;
}

export function formatProviderOptionChoiceLabel(
  descriptor: Extract<LocalizableProviderOptionDescriptor, { type: "select" }>,
  option: { readonly id: string; readonly label: string },
  t: TFunction,
): string {
  // Strength names follow each provider; other known control labels can be translated.
  if (isThoughtLevel(descriptor)) return option.label;
  const key = optionChoiceKeys.get(option.label);
  return key ? t(key) : option.label;
}

export function getLocalizedProviderOptionCurrentLabel(
  descriptor: LocalizableProviderOptionDescriptor,
  t: TFunction,
  selection?: ModelSelection | null,
  reportedSelection?: ModelSelection | null,
): string | undefined {
  const label = getProviderOptionCurrentLabel(descriptor, selection, reportedSelection);
  if (descriptor.type === "boolean") {
    if (label === "On") return t("common.on");
    if (label === "Off") return t("common.off");
    return label;
  }
  const currentValue = getProviderOptionCurrentValue(descriptor, selection, reportedSelection);
  const option = descriptor.options.find((option) => option.id === currentValue);
  if (option) return formatProviderOptionChoiceLabel(descriptor, option, t);
  // These two fallback labels come from the native option resolver, not a catalog choice.
  if (label === "Default") return t("chat.traits.default");
  if (label === "Unknown") return t("common.unknown");
  return label;
}

export function formatProviderOptionDescription(description: string, t: TFunction): string {
  if (description === "Even faster, more expensive") return t("chat.traits.description.ultrafast");
  if (description === "2x speed, increased usage") return t("chat.traits.description.fast");
  if (description === "xhigh effort plus multi-agent workflow orchestration")
    return t("chat.traits.description.ultracode");
  return description;
}
