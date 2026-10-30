import {
  DEFAULT_TEXT_GENERATION_MODEL,
  ANTIGRAVITY_DEFAULT_MODEL,
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  type CustomModelDefinition,
  readCustomModelEntries,
  mergeCustomModels,
  normalizeCustomModelSlug,
  resolveSelectableModel,
  resolveNativeDefaultModelSelection,
} from "@t3tools/shared/model";

import { UnifiedSettings } from "@t3tools/contracts/settings";

import { ModelEsque } from "./components/chat/providerIconUtils";
import { type ProviderInstanceEntry, deriveProviderInstanceEntries } from "./providerInstances";
import { sortModelsForProviderInstance } from "./modelOrdering";
import { resolveModelShortName } from "@t3tools/client-runtime/provider-clients";

export const MAX_CUSTOM_MODEL_LENGTH = 256;
const DEFAULT_TEXT_GENERATION_INSTANCE_ID = ProviderInstanceId.make("codex");

// Legacy per-driver buckets would leak custom-instance models into stock instances.
function readInstanceCustomModels(
  settings: UnifiedSettings,
  instanceId: ProviderInstanceId,
): ReadonlyArray<CustomModelDefinition> {
  const instance = settings.providerInstances?.[instanceId];
  const config = instance?.config;
  if (config !== null && typeof config === "object") {
    const value = (config as Record<string, unknown>).customModels;
    if (Array.isArray(value)) {
      return readCustomModelEntries(value);
    }
  }
  return [];
}

export interface AppModelOption {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  aliases?: ReadonlyArray<string>;
  badge?: "new";
  isCustom: boolean;
  isDefault?: boolean;
  isLegacy?: boolean;
  isUnavailable?: boolean;
}

function appendUnavailableDynamicModelSelection(
  options: AppModelOption[],
  rawModels: ReadonlyArray<ServerProvider["models"][number]>,
  provider: ProviderDriverKind,
  selectedModel: string | null | undefined,
  hiddenModels: ReadonlyArray<string>,
): AppModelOption[] {
  if (provider !== "opencode" && provider !== "antigravity") return options;
  if (rawModels.length === 0) return options;
  const slug = normalizeCustomModelSlug(selectedModel);
  if (!slug) return options;
  if (provider === "antigravity" && slug === ANTIGRAVITY_DEFAULT_MODEL) return options;

  if (resolveSelectableModel(provider, slug, rawModels) !== null) return options;
  if (hiddenModels.includes(slug)) return options;
  if (options.some((option) => option.slug === slug)) return options;

  return [...options, { slug, name: slug, isCustom: false, isUnavailable: true }];
}

function toAppModelOption(
  model: ServerProvider["models"][number],
  driverKind: ProviderDriverKind,
): AppModelOption {
  const option: AppModelOption = {
    slug: model.slug,
    name: model.name,
    isCustom: model.isCustom,
  };
  const shortName = resolveModelShortName(model, driverKind);
  if (shortName) option.shortName = shortName;
  if (model.subProvider) option.subProvider = model.subProvider;
  if (model.aliases) option.aliases = model.aliases;
  if (model.badge) option.badge = model.badge;
  if (model.isDefault) option.isDefault = true;
  if (model.isLegacy) option.isLegacy = true;
  return option;
}

function readInstanceModelPreferences(
  settings: UnifiedSettings,
  instanceId: ProviderInstanceId,
): { readonly hiddenModels: ReadonlyArray<string>; readonly modelOrder: ReadonlyArray<string> } {
  return (
    settings.providerModelPreferences?.[instanceId] ?? {
      hiddenModels: [],
      modelOrder: [],
    }
  );
}

function applyInstanceModelPreferences(
  options: ReadonlyArray<AppModelOption>,
  preferences: {
    readonly hiddenModels: ReadonlyArray<string>;
    readonly modelOrder: ReadonlyArray<string>;
  },
): AppModelOption[] {
  const hiddenModels = new Set(preferences.hiddenModels);
  return sortModelsForProviderInstance(
    options.filter((option) => option.isCustom || !hiddenModels.has(option.slug)),
    { modelOrder: preferences.modelOrder },
  );
}

/** Models and custom slugs belong to each provider instance. Ignore server custom rows so removing a slug takes effect before the next probe. */
export function getAppModelOptionsForInstance(
  settings: UnifiedSettings,
  entry: ProviderInstanceEntry,
  selectedModel?: string | null,
): AppModelOption[] {
  const customModels = readInstanceCustomModels(settings, entry.instanceId);
  const options = mergeCustomModels(
    entry.models.filter((model) => !model.isCustom),
    customModels,
  ).map((model) => toAppModelOption(model, entry.driverKind));
  if (selectedModel && !options.some((option) => option.slug === selectedModel)) {
    options.push({
      slug: selectedModel,
      name: selectedModel,
      isCustom: false,
      ...(entry.models.length > 0 &&
      selectedModel !== ANTIGRAVITY_DEFAULT_MODEL &&
      (entry.driverKind === "opencode" || entry.driverKind === "antigravity")
        ? { isUnavailable: true }
        : {}),
    });
  }
  const preferences = readInstanceModelPreferences(settings, entry.instanceId);
  return appendUnavailableDynamicModelSelection(
    applyInstanceModelPreferences(options, preferences),
    entry.models,
    entry.driverKind,
    selectedModel,
    preferences.hiddenModels,
  );
}

export function resolveAppModelSelectionForInstance(
  instanceId: ProviderInstanceId,
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedModel: string | null | undefined,
  _resolutionOptions?: { readonly preserveUnavailableSelection?: boolean },
): string | null {
  const entry = deriveProviderInstanceEntries(providers).find(
    (candidate) => candidate.instanceId === instanceId,
  );
  if (!entry) return null;
  return (
    resolveNativeDefaultModelSelection({ instanceId, model: selectedModel || null }, entry.models)
      .model ?? ""
  );
}

export function resolveEffectiveDefaultModelSelection(
  _settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection,
): ModelSelection {
  return resolveNativeDefaultModelSelection(
    selection,
    providers.find((provider) => provider.instanceId === selection.instanceId)?.models ?? [],
  );
}

export function getCustomModelOptionsByInstance(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedInstanceId?: ProviderInstanceId | null,
  selectedModel?: string | null,
): ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>> {
  const out = new Map<ProviderInstanceId, ReadonlyArray<ModelEsque>>();
  for (const entry of deriveProviderInstanceEntries(providers)) {
    out.set(
      entry.instanceId,
      getAppModelOptionsForInstance(
        settings,
        entry,
        entry.instanceId === selectedInstanceId ? selectedModel : null,
      ),
    );
  }
  return out;
}

export function selectsPlanAgent(options: ModelSelection["options"]): boolean {
  return options?.some((option) => option.id === "agent" && option.value === "plan") ?? false;
}

export function resolveAppModelSelectionState(
  settings: UnifiedSettings,
  _providers: ReadonlyArray<ServerProvider>,
): ModelSelection {
  const selection = settings.textGenerationModelSelection ?? {
    instanceId: DEFAULT_TEXT_GENERATION_INSTANCE_ID,
    model: DEFAULT_TEXT_GENERATION_MODEL,
  };
  return selection;
}
