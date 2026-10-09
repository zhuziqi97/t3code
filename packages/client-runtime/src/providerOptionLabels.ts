import type { TFunction } from "i18next";
import type { ModelSelection, ProviderOptionDescriptor } from "@t3tools/contracts";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
} from "@t3tools/shared/model";

const REASONING_IDS = new Set(["reasoningEffort", "reasoning", "effort", "variant", "thinking"]);
const REASONING_CHOICES = {
  none: ["None", "chat.traits.choice.none"],
  minimal: ["Minimal", "chat.traits.choice.minimal"],
  low: ["Low", "chat.traits.choice.low"],
  medium: ["Medium", "chat.traits.choice.medium"],
  high: ["High", "chat.traits.choice.high"],
  xhigh: ["Extra High", "chat.traits.choice.xhigh"],
  max: ["Max", "chat.traits.choice.max"],
  ultra: ["Ultra", "chat.traits.choice.ultra"],
} as const;
const SPEED_CHOICES = {
  default: ["Standard", "chat.traits.choice.standard"],
  priority: ["Fast", "chat.traits.choice.fast"],
  fast: ["Fast", "chat.traits.choice.fast"],
  ultrafast: ["Ultrafast", "chat.traits.choice.ultrafast"],
  flex: ["Flex", "chat.traits.choice.flex"],
} as const;

/** Display known catalog words without modifying provider metadata or custom labels. */
export function formatProviderOptionName(
  descriptor: ProviderOptionDescriptor,
  t: TFunction,
): string {
  const { id, label } = descriptor;
  if (REASONING_IDS.has(id) && ["Reasoning", "Reasoning effort", "Effort"].includes(label))
    return t("chat.traits.reasoningEffort");
  if (id === "thinking" && label === "Thinking") return t("chat.traits.name.thinking");
  if (id === "fastMode" && label === "Fast Mode") return t("chat.traits.name.fastMode");
  if (id === "serviceTier" && label === "Service Tier") return t("chat.traits.name.serviceTier");
  if (id === "contextWindow" && label === "Context Window")
    return t("chat.traits.name.contextWindow");
  if (id === "agent" && label === "Agent") return t("chat.traits.name.agent");
  return label;
}

export function formatProviderOptionChoiceLabel(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
  option: { readonly id: string; readonly label: string },
  t: TFunction,
): string {
  const known = REASONING_IDS.has(descriptor.id)
    ? REASONING_CHOICES[option.id as keyof typeof REASONING_CHOICES]
    : descriptor.id === "serviceTier"
      ? SPEED_CHOICES[option.id as keyof typeof SPEED_CHOICES]
      : undefined;
  if (known && known[0] === option.label) return t(known[1]);
  if (descriptor.id === "agent") {
    if (option.id === "build" && option.label === "Build") return t("chat.traits.choice.build");
    if (option.id === "plan" && option.label === "Plan") return t("chat.traits.choice.plan");
  }
  return option.label;
}

export function getLocalizedProviderOptionCurrentLabel(
  descriptor: ProviderOptionDescriptor,
  t: TFunction,
  selection?: ModelSelection | null,
  reportedSelection?: ModelSelection | null,
): string | undefined {
  const label = getProviderOptionCurrentLabel(descriptor, selection, reportedSelection);
  if (descriptor.type === "boolean")
    return label === "On"
      ? t("common.on")
      : label === "Off"
        ? t("options.notifications.off")
        : label;
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
