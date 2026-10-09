import {
  ConveneMcpCapabilities,
  ConveneMcpScope,
  type ConveneProjectConfiguration,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const Draft = Schema.Struct({
  enabled: Schema.Boolean,
  scope: Schema.Array(ConveneMcpScope),
  capabilities: ConveneMcpCapabilities,
});
export type ConveneDraft = typeof Draft.Type;
const decode = Schema.decodeUnknownOption(Draft);

export function configurationDraft(configuration: ConveneProjectConfiguration): ConveneDraft {
  return {
    enabled: configuration.mcp_enabled,
    scope: configuration.mcp_scope_modules,
    capabilities: configuration.mcp_capabilities,
  };
}

export function sameConveneDraft(left: ConveneDraft, right: ConveneDraft): boolean {
  if (
    left.enabled !== right.enabled ||
    left.capabilities.code_graph_enabled !== right.capabilities.code_graph_enabled ||
    left.capabilities.forge_enabled !== right.capabilities.forge_enabled ||
    left.capabilities.issue_enabled !== right.capabilities.issue_enabled ||
    left.scope.length !== right.scope.length
  )
    return false;
  return left.scope.every((entry) =>
    right.scope.some(
      (other) => entry.module_id === other.module_id && entry.permission === other.permission,
    ),
  );
}

export function readConveneDraft(key: string): ConveneDraft | null {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return null;
    const parsed = decode(JSON.parse(value));
    return parsed._tag === "Some" ? parsed.value : null;
  } catch {
    return null;
  }
}

export function writeConveneDraft(key: string, draft: ConveneDraft | null): void {
  if (draft === null) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(draft));
}
