import type { TFunction } from "i18next";
import type { ServerConfig } from "@t3tools/contracts";
import * as Option from "effect/Option";

import type { ConnectionCatalogEntry } from "./catalog.ts";
import type { ConnectionTarget, SupervisorConnectionState } from "./model.ts";
import { connectionRouteId, connectionRoutes, routeHttpBaseUrl } from "./routes.ts";

export type EnvironmentConnectionPhase =
  | "available"
  | "offline"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "error"
  | "unsupported";

export interface EnvironmentConnectionPresentation {
  readonly phase: EnvironmentConnectionPhase;
  readonly error: string | null;
  readonly traceId: string | null;
}

export interface EnvironmentPresentation {
  readonly entry: ConnectionCatalogEntry;
  readonly connection: EnvironmentConnectionPresentation;
  readonly serverConfig: ServerConfig | null;
}

/** Translate connection-owned messages without changing wire errors or unknown diagnostics. */
export function formatConnectionErrorMessage(message: string, t?: TFunction): string {
  if (!t) return message;
  const fixedMessages: Record<string, string> = {
    "The environment credential is invalid.": "connections.error.invalidCredential",
    "The environment credential does not grant the required access.":
      "connections.error.accessRequired",
    "The environment rejected the authentication request.": "connections.error.authRejected",
    "The environment endpoint could not be found.": "connections.error.endpointMissing",
    "The environment could not authorize the connection.": "connections.error.authUnavailable",
    "The pairing details are invalid.": "connections.error.invalidPairing",
    "The saved bearer credential is unavailable.": "connections.error.credentialUnavailable",
    "Environment label cannot be empty.": "connections.error.labelRequired",
    "Invalid pairing token. Check the token and try again.": "connections.error.invalidToken",
    "Enter a pairing token to continue.": "connections.error.tokenRequired",
    "Timed out waiting for authenticated session after bootstrap.":
      "connections.error.sessionTimeout",
  };
  const key = fixedMessages[message];
  if (key !== undefined) return t(key);

  const fetchFailure = /^Failed to fetch remote environment endpoint (\S+) \(([\s\S]*)\)\.$/u.exec(
    message,
  );
  if (fetchFailure) {
    return t("connections.error.fetchFailed", {
      url: fetchFailure[1],
      diagnostic: fetchFailure[2],
    });
  }
  const invalidResponse =
    /^Remote environment endpoint returned an invalid response from (.+)\.$/u.exec(message);
  if (invalidResponse) return t("connections.error.invalidResponse", { url: invalidResponse[1] });
  const undeclaredStatus =
    /^Remote environment endpoint (.+) returned undeclared status (\d+)\.$/u.exec(message);
  if (undeclaredStatus) {
    return t("connections.error.undeclaredStatus", {
      url: undeclaredStatus[1],
      status: undeclaredStatus[2],
    });
  }
  const timeout = /^Remote environment endpoint (.+) timed out after (\d+)ms\.$/u.exec(message);
  if (timeout) return t("connections.error.timeout", { url: timeout[1], milliseconds: timeout[2] });
  const differentMachine =
    /^That address reaches ([\s\S]+), a different machine\. Add it as its own environment instead\.$/u.exec(
      message,
    );
  if (differentMachine)
    return t("connections.error.differentMachine", { label: differentMachine[1] });
  const primaryRequest =
    /^Primary environment request failed during ([a-z-]+) \(HTTP (\d+)\)\.$/u.exec(message);
  if (primaryRequest)
    return t("connections.error.primaryRequest", {
      operation: primaryRequest[1],
      status: primaryRequest[2],
    });
  return message;
}

export function presentConnectionState(
  state: SupervisorConnectionState,
): EnvironmentConnectionPresentation {
  switch (state.phase) {
    case "available":
      return { phase: "available", error: null, traceId: null };
    case "offline":
      return { phase: "offline", error: null, traceId: null };
    case "connecting":
      return {
        phase: state.attempt <= 1 && state.lastFailure === null ? "connecting" : "reconnecting",
        error: state.lastFailure?.message ?? null,
        traceId: state.lastFailure?.traceId ?? null,
      };
    case "connected":
      return { phase: "connected", error: null, traceId: null };
    case "backoff":
      return {
        phase: "reconnecting",
        error: state.lastFailure?.message ?? null,
        traceId: state.lastFailure?.traceId ?? null,
      };
    case "blocked":
      return {
        phase: state.lastFailure?.reason === "unsupported" ? "unsupported" : "error",
        error: state.lastFailure?.message ?? null,
        traceId: state.lastFailure?.traceId ?? null,
      };
  }
}

export function connectionStatusText(
  connection: EnvironmentConnectionPresentation,
  t?: TFunction,
): string {
  const error = connection.error ? formatConnectionErrorMessage(connection.error, t) : null;
  switch (connection.phase) {
    case "available":
      return t?.("connections.available") ?? "Available";
    case "offline":
      return t?.("connections.offline") ?? "Offline";
    case "connecting":
      return t?.("connections.connectingDetailed") ?? "Connecting...";
    case "reconnecting":
      return error
        ? (t?.("connections.statusReconnectingReason", { error }) ??
            `Failed to connect. Reconnecting... Reason: ${error}`)
        : (t?.("connections.reconnectingDetailed") ?? "Reconnecting...");
    case "connected":
      return t?.("connections.connected") ?? "Connected";
    case "unsupported":
      return t?.("connections.unsupported") ?? "Client not supported";
    case "error":
      return error
        ? (t?.("connections.statusConnectionFailedReason", { error }) ??
            `Connection failed. Reason: ${error}`)
        : (t?.("connections.connectionFailed") ?? "Connection failed");
  }
}

export function connectionStatusTitle(
  connection: EnvironmentConnectionPresentation,
  t?: TFunction,
): string {
  if (connection.phase === "reconnecting" && connection.error) {
    return t?.("connections.reconnectingTitle") ?? "Failed to connect. Reconnecting...";
  }
  return connectionStatusText({ ...connection, error: null }, t);
}

export function presentEnvironmentConnection(
  state: SupervisorConnectionState,
): EnvironmentConnectionPresentation {
  return presentConnectionState(state);
}

/**
 * The address an agent outside T3 (Claude Code, Codex) uses to reach this
 * environment's MCP server: the route this device is connected over, since an
 * agent beside this client can reach it too, else the first route in
 * preference order that has an address. SSH connections ride a local forward
 * that disappears with the client, so they have no stable address.
 */
export function environmentMcpUrl(input: {
  readonly entry: ConnectionCatalogEntry;
  readonly relayHttpBaseUrl?: string | undefined;
  readonly connectedTarget?: ConnectionTarget | null | undefined;
}): string | null {
  const connectedRouteId = input.connectedTarget ? connectionRouteId(input.connectedTarget) : null;
  const routes = connectionRoutes(input.entry);
  const connectedRoute = routes.find(
    (route) => connectionRouteId(route.target) === connectedRouteId,
  );
  for (const route of connectedRoute ? [connectedRoute, ...routes] : routes) {
    const httpBaseUrl =
      route.target._tag === "RelayConnectionTarget"
        ? (input.relayHttpBaseUrl ?? null)
        : routeHttpBaseUrl(route);
    const mcpUrl = httpBaseUrl === null ? null : mcpUrlFromBase(httpBaseUrl);
    if (mcpUrl !== null) return mcpUrl;
  }
  return null;
}

function mcpUrlFromBase(httpBaseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(httpBaseUrl);
  } catch {
    return null;
  }
  url.pathname = "/mcp";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function connectionCatalogDisplayUrl(entry: ConnectionCatalogEntry): string | null {
  switch (entry.target._tag) {
    case "PrimaryConnectionTarget":
      return entry.target.httpBaseUrl;
    case "RelayConnectionTarget":
      return null;
    case "BearerConnectionTarget":
      return Option.isSome(entry.profile) && entry.profile.value._tag === "BearerConnectionProfile"
        ? entry.profile.value.httpBaseUrl
        : null;
    case "SshConnectionTarget":
      return Option.isSome(entry.profile) && entry.profile.value._tag === "SshConnectionProfile"
        ? `${entry.profile.value.target.username}@${entry.profile.value.target.hostname}`
        : null;
  }
}
