import type { ServerUpdateStage } from "@t3tools/client-runtime/state/server";
import type { TFunction } from "i18next";
import { i18n } from "../i18n";

// The launcher handoff remains part of the download phase in the UI.
export function serverUpdateStageLabel(stage: ServerUpdateStage, t: TFunction = i18n.t): string {
  return t(stage === "resuming" ? "server.update.restarting" : "server.update.downloading");
}

/** Translate this client's update failures; external diagnostics remain verbatim. */
export function formatServerUpdateMessage(message: string, t: TFunction): string {
  if (message === "Server update failed.") return t("server.update.failedMessage");
  if (message === "The desktop app resumed without installing the prepared update.")
    return t("server.update.preparedNotInstalled");
  const resume = /^The server did not resume on t3@(.+)\.$/.exec(message);
  if (resume) return t("server.update.resumeFailed", { version: resume[1] });
  const incomplete = /^The t3@(.+) update ended before the server accepted the restart\.$/.exec(
    message,
  );
  if (incomplete) return t("server.update.incomplete", { version: incomplete[1] });
  const terminal = /^The t3@(.+) update (committed|rolled-back|failed)\.$/.exec(message);
  if (terminal) return t(`server.update.terminal.${terminal[2]}`, { version: terminal[1] });
  return message;
}
