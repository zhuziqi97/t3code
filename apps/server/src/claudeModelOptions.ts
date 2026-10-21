import type { ModelSelection } from "@t3tools/contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  getProviderOptionDescriptors,
  resolvePromptInjectedEffort,
} from "@t3tools/shared/model";

import {
  BUNDLED_CLAUDE_MODEL_CATALOG,
  getClaudeCatalogModelCapabilities,
  isClaudeCatalogUltracodeEffort,
  normalizeClaudeCatalogEffort,
  resolveClaudeCatalogApiModelId,
  resolveClaudeCatalogEffort,
  resolveClaudeCatalogCustomContextWindowTokens,
  type ClaudeModelCatalog,
} from "./provider/ClaudeModelCatalog.ts";

export interface CompiledClaudeModelSelection {
  readonly apiModelId: string | undefined;
  readonly effort: string | undefined;
  readonly promptEffort: string | undefined;
  readonly settings: Readonly<Record<string, boolean>>;
  readonly environment: Readonly<Record<string, string>>;
  readonly queryIdentity: string;
}

export function compileClaudeModelSelection(
  selection: ModelSelection,
  catalog: ClaudeModelCatalog = BUNDLED_CLAUDE_MODEL_CATALOG,
): CompiledClaudeModelSelection {
  const capabilities = getClaudeCatalogModelCapabilities(catalog, selection.model);
  const descriptors = getProviderOptionDescriptors({ caps: capabilities });
  const supportsBoolean = (id: string) =>
    descriptors.some((descriptor) => descriptor.type === "boolean" && descriptor.id === id);
  const rawEffort = getModelSelectionStringOptionValue(selection, "effort");
  const promptEffort = resolvePromptInjectedEffort(capabilities, rawEffort) ?? undefined;
  const resolvedEffort =
    (promptEffort === undefined ? rawEffort : undefined) ??
    (selection.model === null
      ? undefined
      : resolveClaudeCatalogEffort(catalog, selection.model, rawEffort));
  const effort = normalizeClaudeCatalogEffort(catalog, resolvedEffort, selection.model);
  const fastMode =
    getModelSelectionBooleanOptionValue(selection, "fastMode") ??
    (selection.model !== null && supportsBoolean("fastMode") ? false : undefined);
  const thinking = getModelSelectionBooleanOptionValue(selection, "thinking");
  const settings = {
    ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
    ...(typeof fastMode === "boolean" ? { fastMode } : {}),
    ...(isClaudeCatalogUltracodeEffort(resolvedEffort) ? { ultracode: true } : {}),
  };
  const apiModelId = resolveClaudeCatalogApiModelId(catalog, selection);
  const allowance = resolveClaudeCatalogCustomContextWindowTokens(catalog, selection);
  if (
    allowance !== undefined &&
    selection.model !== null &&
    /claude-|^(?:claude|default|best|fable|opus|sonnet|haiku|opusplan)$|\[1m\]/i.test(
      selection.model,
    )
  ) {
    throw new TypeError(
      "contextWindowTokens applies only to non-Claude custom model IDs; Claude models and native aliases use Claude Code's native context window.",
    );
  }
  const environment =
    allowance === undefined ? {} : { CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(allowance) };
  return {
    apiModelId,
    effort,
    promptEffort,
    settings,
    environment,
    queryIdentity: JSON.stringify({ apiModelId, effort: effort ?? null, settings, environment }),
  };
}
