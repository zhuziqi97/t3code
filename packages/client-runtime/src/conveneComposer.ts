import type {
  ConveneProjectConfiguration,
  ConveneResourceSearchResult,
  EnvironmentId,
  ProjectId,
  ServerProvider,
} from "@t3tools/contracts";

export type ConveneComposerTarget = {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  kind: "issue" | "document" | "guideline";
  query: string;
};
export type ConveneComposerResource = Extract<
  ConveneResourceSearchResult,
  { status: "ready" }
>["items"][number];
export type ConveneComposerStatus = ConveneResourceSearchResult["status"];
export type ConveneComposerItem =
  | { type: "convene-resource"; resource: ConveneComposerResource }
  | { type: "convene-guideline" };

export type ConveneComposerCommandItem = ConveneComposerItem & {
  id: string;
  label: string;
  description: string;
  target: ConveneComposerTarget;
};
export type ConveneComposerFooter = {
  message: string | null;
  pending: boolean;
  previousPage: (() => void) | null;
  nextPage: (() => void) | null;
  refresh: (() => void) | null;
};

export function sameConveneComposerTarget(
  left: ConveneComposerTarget | null,
  right: ConveneComposerTarget | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.environmentId === right.environmentId &&
      left.projectId === right.projectId &&
      left.kind === right.kind &&
      left.query === right.query)
  );
}

export function conveneComposerTarget(
  environmentId: EnvironmentId | null,
  projectId: ProjectId | null,
  trigger: { kind: string; query: string } | null,
): ConveneComposerTarget | null {
  if (!environmentId || !projectId || !trigger) return null;
  const kind =
    trigger.kind === "path"
      ? "document"
      : trigger.kind === "pull-request"
        ? "issue"
        : trigger.kind === "skill"
          ? "guideline"
          : null;
  return kind ? { environmentId, projectId, kind, query: trigger.query.trim() } : null;
}

export function conveneGuidelineStatus(
  fresh: boolean,
  configuration: ConveneProjectConfiguration | null,
): ConveneComposerStatus {
  if (!fresh) return "unavailable";
  if (!configuration) return "projectUnavailable";
  if (!configuration.mcp_enabled) return "mcpDisabled";
  return configuration.mcp_scope_modules.length > 0 ? "ready" : "scopeInsufficient";
}

export function conveneGuidelineProviderStatus(
  provider: Pick<ServerProvider, "enabled" | "installed" | "auth" | "supportsMcpTools"> | null,
) {
  if (provider?.supportsMcpTools === false) return "providerUnsupported";
  if (!provider || provider.supportsMcpTools === undefined) return "providerUnknown";
  if (
    !provider.enabled ||
    provider.installed === false ||
    provider.auth.status === "unauthenticated"
  ) {
    return "providerUnavailable";
  }
  return null;
}

export function matchesConveneGuideline(query: string): boolean {
  return ["convene", "platform", "guideline", "平台", "指南", "说明"].some((value) =>
    value.includes(query.toLowerCase()),
  );
}

export function serializeConveneComposerItem(item: ConveneComposerItem): string {
  if (item.type === "convene-guideline") {
    return "Use the authorized Convene MCP to call get_platform_guideline (or read convene://reference/platform) before working with platform resources. ";
  }
  const resource = item.resource;
  const label =
    `Convene ${resource.kind === "issue" ? `#${resource.number}` : resource.relative_path} · ${resource.title}`
      .replaceAll("\\", "\\\\")
      .replaceAll("[", "\\[")
      .replaceAll("]", "\\]")
      .replaceAll(/\r?\n/g, " ");
  return `[${label}](<${resource.resource_uri}>) `;
}

export type ConveneComposerSearchState = {
  target: ConveneComposerTarget | null;
  pending: boolean;
  result: ConveneResourceSearchResult | null;
  page: number;
};

/** Each location owns its results; changing project, query or page discards late replies. */
export function createConveneComposerSearch(
  search: (target: ConveneComposerTarget, page: number) => Promise<ConveneResourceSearchResult>,
  changed: (state: ConveneComposerSearchState) => void,
) {
  let generation = 0;
  const clear = () => {
    generation++;
    changed({ target: null, pending: false, result: null, page: 1 });
  };
  const load = async (target: ConveneComposerTarget, page = 1) => {
    const request = ++generation;
    changed({ target, pending: true, result: null, page });
    let result: ConveneResourceSearchResult;
    try {
      result = await search(target, page);
    } catch {
      result = { status: "unavailable" };
    }
    if (request === generation) changed({ target, pending: false, result, page });
  };
  return { clear, load };
}
