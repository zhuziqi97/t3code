import type { TFunction } from "i18next";
import type { MessageKey } from "@t3tools/client-runtime/i18n";

// Current client and resource-monitor errors; arbitrary diagnostics remain verbatim.
const messages: Readonly<Record<string, MessageKey>> = {
  "Could not check this connection's access to diagnostics and usage.": "diagnostics.access.failed",
  "This environment is not connected.": "diagnostics.access.disconnected",
  "This connection does not have access to diagnostics and usage.": "diagnostics.access.denied",
  "No environment is selected.": "diagnostics.monitor.no-environment",
  "This connection cannot restart the resource monitor.": "diagnostics.monitor.access-denied",
};

export function formatDiagnosticsMessage(message: string, t: TFunction): string {
  const key = messages[message];
  if (key) return t(key);
  const unsupported = /^Resource monitoring is unsupported on (.+)\.$/.exec(message);
  if (unsupported) return t("diagnostics.monitor.binary.unsupported", { platform: unsupported[1] });
  const missing = /^Resource monitor binary was not found for (.+)\.$/.exec(message);
  if (missing) return t("diagnostics.monitor.binary.missing", { platform: missing[1] });
  const notExecutable = /^Resource monitor binary at '(.+)' is not executable\.$/.exec(message);
  if (notExecutable)
    return t("diagnostics.monitor.binary.not-executable", { path: notExecutable[1] });
  return message;
}
