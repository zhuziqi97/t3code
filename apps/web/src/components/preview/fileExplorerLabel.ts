import type { ExecutionEnvironmentPlatformOs, FileManagerRevealKind } from "@t3tools/contracts";
import type { TFunction } from "i18next";
import { i18n } from "~/i18n";

export function revealInFileExplorerLabel(platform: string, t: TFunction = i18n.t): string {
  const normalized = platform.toLowerCase();
  if (normalized.includes("mac")) return t("fileMenu.reveal.finder");
  if (normalized.includes("win")) return t("fileMenu.reveal.explorer");
  return t("fileMenu.reveal.files");
}

/** Same wording keyed by an environment's reported OS rather than a
    navigator platform string, for actions that reveal on the server machine. */
export function revealInFileExplorerLabelForOs(
  os: ExecutionEnvironmentPlatformOs,
  t: TFunction = i18n.t,
): string {
  if (os === "darwin") return t("fileMenu.reveal.finder");
  if (os === "windows") return t("fileMenu.reveal.explorer");
  return t("fileMenu.reveal.files");
}

/** Server-selected wording, including Windows File Explorer reached from WSL. */
export function revealInFileExplorerLabelForKind(
  kind: FileManagerRevealKind,
  t: TFunction = i18n.t,
): string {
  if (kind === "finder") return t("fileMenu.reveal.finder");
  if (kind === "file-explorer") return t("fileMenu.reveal.explorer");
  return t("fileMenu.reveal.files");
}
