import type { TFunction } from "i18next";
import type { ModelSelection, ProviderOptionDescriptor } from "@t3tools/contracts";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
} from "@t3tools/shared/model";

/** Native option labels remain consistent with the provider's own controls. */
export function formatProviderOptionName(
  descriptor: ProviderOptionDescriptor,
  _t: TFunction,
): string {
  return descriptor.label;
}

export function formatProviderOptionChoiceLabel(
  _descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
  option: { readonly id: string; readonly label: string },
  _t: TFunction,
): string {
  return option.label;
}

export function getLocalizedProviderOptionCurrentLabel(
  descriptor: ProviderOptionDescriptor,
  t: TFunction,
  selection?: ModelSelection | null,
  reportedSelection?: ModelSelection | null,
): string | undefined {
  const label = getProviderOptionCurrentLabel(descriptor, selection, reportedSelection);
  if (descriptor.type === "boolean") return label;
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
