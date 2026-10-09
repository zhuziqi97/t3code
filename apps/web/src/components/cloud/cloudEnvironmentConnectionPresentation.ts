import type { TFunction } from "i18next";
import { type EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { i18n } from "../../i18n";

export interface SavedCloudEnvironmentConnectionPresentation {
  readonly buttonLabel: string;
  readonly statusText: string;
  readonly tone: "connected" | "connecting" | "error" | "idle";
}

/**
 * Present the live supervisor state for an environment that is already in the
 * connection catalog. Catalog membership only means the environment is saved;
 * it does not mean the connection attempt succeeded.
 */
export function presentSavedCloudEnvironmentConnection(
  connection: EnvironmentConnectionPresentation,
  translate: TFunction = i18n.t,
): SavedCloudEnvironmentConnectionPresentation {
  const statusText =
    connection.phase === "reconnecting"
      ? translate(
          connection.error
            ? "connection.status.reconnectingReason"
            : "connection.status.reconnecting",
          { reason: connection.error },
        )
      : connection.phase === "error" && connection.error
        ? translate("connection.status.failedReason", { reason: connection.error })
        : translate(
            {
              connected: "connection.connected",
              connecting: "connection.status.connecting",
              unsupported: "connection.unsupported",
              error: "connection.failed",
              offline: "connection.offline",
              available: "connection.status.available",
            }[connection.phase],
          );
  switch (connection.phase) {
    case "connected":
      return {
        buttonLabel: translate("connection.connected"),
        statusText,
        tone: "connected",
      };
    case "connecting":
      return {
        buttonLabel: translate("connection.connecting"),
        statusText,
        tone: "connecting",
      };
    case "reconnecting":
      return {
        buttonLabel: translate("connection.reconnecting"),
        statusText,
        tone: "connecting",
      };
    // Not a failure: the machine is fine, this build just cannot talk to it.
    case "unsupported":
      return {
        buttonLabel: translate("connection.unsupported"),
        statusText,
        tone: "idle",
      };
    case "error":
      return {
        buttonLabel: translate("connection.failed"),
        statusText,
        tone: "error",
      };
    case "offline":
      return {
        buttonLabel: translate("connection.offline"),
        statusText,
        tone: "idle",
      };
    case "available":
      return {
        buttonLabel: translate("connection.notConnected"),
        statusText,
        tone: "idle",
      };
  }
}
