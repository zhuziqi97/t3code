import type { TFunction } from "i18next";
import {
  formatConnectionErrorMessage,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import { i18n } from "../../i18n";
import { msg } from "gt-react";

import { m, type MessageResolver } from "~/i18n/messages";

export interface SavedCloudEnvironmentConnectionPresentation {
  readonly buttonLabel: string;
  readonly statusText: string;
  readonly tone: "connected" | "connecting" | "error" | "idle";
}

/** Components pass `useMessages()` so the label follows a language switch. */
export function presentSavedCloudEnvironmentConnection(
  connection: EnvironmentConnectionPresentation,
  resolve: MessageResolver = m,
  translate: TFunction = i18n.t,
): SavedCloudEnvironmentConnectionPresentation {
  const statusText =
    connection.phase === "reconnecting"
      ? translate(
          connection.error
            ? "connection.status.reconnectingReason"
            : "connection.status.reconnecting",
          {
            reason: connection.error
              ? formatConnectionErrorMessage(connection.error, translate)
              : null,
          },
        )
      : connection.phase === "error" && connection.error
        ? translate("connection.status.failedReason", {
            reason: formatConnectionErrorMessage(connection.error, translate),
          })
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
        buttonLabel: connection.awaitingApproval
          ? resolve(msg("Waiting for approval…"))
          : translate("connection.reconnecting"),
        statusText,
        tone: "connecting",
      };
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
