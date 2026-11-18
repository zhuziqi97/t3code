import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ProviderDriverKind,
  type ModelSelection,
  type ProviderInstanceId,
  type ModelCapabilities,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities, resolveSelectableModel } from "@t3tools/shared/model";

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

export function resolveModelForCapabilities(input: {
  model: string | null | undefined;
  instanceId?: ProviderInstanceId | undefined;
  reportedModelSelection?: ModelSelection | null | undefined;
}): string | null {
  return (
    input.model ||
    (input.instanceId !== undefined && input.reportedModelSelection?.instanceId === input.instanceId
      ? input.reportedModelSelection.model
      : null)
  );
}

const RUNTIME_MODEL_CATALOG_DRIVERS: ReadonlySet<string> = new Set([
  "opencode",
  "antigravity",
  "cursor",
  "pi",
  "acpRegistry",
]);

// These drivers discover models at runtime, so a refresh can briefly omit a model the user chose.
export function hasRuntimeModelCatalog(provider: ProviderDriverKind): boolean {
  return RUNTIME_MODEL_CATALOG_DRIVERS.has(provider);
}

// These markers follow the session's current model rather than naming an unavailable model.
export function isRuntimeModelDefaultAlias(
  provider: ProviderDriverKind,
  model: string | null | undefined,
): boolean {
  return (
    (provider === "antigravity" || provider === "acpRegistry") &&
    model === DEFAULT_MODEL_BY_PROVIDER[provider]
  );
}

// Antigravity lists its default model only as an alias, which a slug lookup would call missing.
export function keepsUnavailableModelOptions(
  provider: ProviderDriverKind,
  model: string | null | undefined,
): boolean {
  return (
    provider !== "antigravity" &&
    !isRuntimeModelDefaultAlias(provider, model) &&
    hasRuntimeModelCatalog(provider)
  );
}

export function formatProviderDriverKindLabel(provider: ProviderDriverKind): string {
  return provider
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getProviderModelCapabilities(
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  provider: ProviderDriverKind,
  includePlanAgent = false,
): ModelCapabilities {
  const slug = resolveSelectableModel(provider, model, models);
  const selectedModel = models.find((candidate) => candidate.slug === slug);
  const caps = selectedModel?.capabilities ?? EMPTY_CAPABILITIES;
  if (includePlanAgent) {
    return caps;
  }
  return withoutPlanAgentOption(caps);
}

function withoutPlanAgentOption(caps: ModelCapabilities): ModelCapabilities {
  return {
    ...caps,
    optionDescriptors: (caps.optionDescriptors ?? []).flatMap((descriptor) => {
      if (descriptor.type !== "select" || descriptor.id !== "agent") {
        return [descriptor];
      }
      const options = descriptor.options.filter((option) => option.id !== "plan");
      if (options.length === 0) {
        return [];
      }
      const currentValue =
        descriptor.currentValue && options.some((option) => option.id === descriptor.currentValue)
          ? descriptor.currentValue
          : (options.find((option) => option.isDefault)?.id ?? options[0]?.id);
      return [{ ...descriptor, options, ...(currentValue ? { currentValue } : {}) }];
    }),
  };
}
