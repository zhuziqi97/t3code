import type {
  ConveneProjectConfiguration,
  ConveneIdeRequest,
  ConveneStatus,
  ProjectId,
} from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";

type IdeFile = Extract<ConveneIdeRequest, { workspaceKey: string }>["file"];

export function conveneIdeLink(input: {
  status: ConveneStatus;
  configuration: ConveneProjectConfiguration;
  projectId: ProjectId;
  workspacePath: string;
  file?: IdeFile;
  mountedOrigin?: string;
}): string | null {
  const { status, configuration } = input;
  if (
    status.phase !== "online" ||
    !status.runnerId ||
    !status.baseUrl ||
    configuration.runner_id !== status.runnerId ||
    configuration.project.native_project_id !== input.projectId
  )
    return null;
  const workspace = configuration.targets.find(
    (target) =>
      target.availability === "AVAILABLE" &&
      target.path !== null &&
      normalizeProjectPathForComparison(target.path) ===
        normalizeProjectPathForComparison(input.workspacePath),
  );
  if (!workspace) return null;
  // Mounted clients keep the entry they are already using, including LAN versus public access.
  const url = new URL(
    `/clients/${encodeURIComponent(status.runnerId)}/ide`,
    input.mountedOrigin ?? status.baseUrl,
  );
  url.searchParams.set("projectId", input.projectId);
  url.searchParams.set("workspaceKey", workspace.native_workspace_key);
  if (input.file) {
    url.searchParams.set("file", input.file.relativePath);
    if (input.file.line !== undefined) url.searchParams.set("line", String(input.file.line));
    if (input.file.column !== undefined) url.searchParams.set("column", String(input.file.column));
  }
  return url.href;
}
