import type { TFunction } from "i18next";
import type { ServerConfig } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { NETWORK_BLOCKING_HINT } from "../errors/network.ts";
import { DPOP_CLOCK_HINT, DPOP_UNKNOWN_HINT, DPOP_RETRY_HINT } from "../relay/errorPresentation.ts";

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

const connectionErrorSuffixes = [
  [` ${NETWORK_BLOCKING_HINT}`, "connections.error.networkHint"],
  [` ${DPOP_CLOCK_HINT}`, "connections.error.clockHint"],
  [` ${DPOP_UNKNOWN_HINT}`, "connections.error.unknownDpopHint"],
  [` ${DPOP_RETRY_HINT}`, "connections.error.retryDpopHint"],
] as const;

const fixedMessages: Record<string, string> = {
  "Sign in to T3 Connect to connect this environment.": "connections.error.cloudSignIn",
  "The T3 Connect session is unavailable.": "connections.error.cloudSession",
  "SSH environments are only available in the desktop app.": "connections.error.sshDesktopOnly",
  "The SSH environment did not issue a pairing credential.": "connections.error.sshPairing",
  "Relay rejected the cloud session token.": "connections.error.relayCloudToken",
  "Relay rejected the DPoP proof.": "connections.error.relayDpop",
  "Relay rejected the authenticated request.": "connections.error.relayAuthenticatedRequest",
  "Relay rejected an expired environment link proof.": "connections.error.relayExpiredLinkProof",
  "Relay has no active link for this environment. The environment server may not have re-established its link yet.":
    "connections.error.relayMissingLink",
  "Relay rejected the environment connection request.": "connections.error.relayConnectRejected",
  "Relay timed out while contacting the environment endpoint.":
    "connections.error.relayEndpointTimeout",
  "Relay rejected an expired agent activity publish proof.":
    "connections.error.relayExpiredActivityProof",
  "Could not load relay DPoP proof key.": "connections.error.relayDpopKey",
  "Relay URL must be a secure absolute HTTPS origin.": "connections.error.relayUrl",
  "Relay granted unexpected DPoP access token scopes.": "connections.error.relayScopes",
  "Could not create relay token DPoP proof.": "connections.error.relayTokenProof",
  "Could not create relay request DPoP proof.": "connections.error.relayRequestProof",
  "Offline for a while, so its T3 Connect tunnel was removed. Start T3 Code on that computer and update it to the latest version to reconnect.":
    "connections.error.tunnelReleased",
  "Could not exchange relay DPoP access token.": "connections.error.relay.tokenExchange.failed",
  "Relay DPoP access token exchange timed out.": "connections.error.relay.tokenExchange.timeout",
  "Could not list relay-managed environments.": "connections.error.relay.environmentList.failed",
  "Relay environment listing timed out.": "connections.error.relay.environmentList.timeout",
  "Could not list relay client devices.": "connections.error.relay.deviceList.failed",
  "Relay client device listing timed out.": "connections.error.relay.deviceList.timeout",
  "Could not create relay environment link challenge.":
    "connections.error.relay.linkChallenge.failed",
  "Relay environment link challenge timed out.": "connections.error.relay.linkChallenge.timeout",
  "Could not link relay environment.": "connections.error.relay.link.failed",
  "Relay environment linking timed out.": "connections.error.relay.link.timeout",
  "Could not unlink relay environment.": "connections.error.relay.unlink.failed",
  "Relay environment unlinking timed out.": "connections.error.relay.unlink.timeout",
  "Could not get relay environment status.": "connections.error.relay.status.failed",
  "Relay environment status request timed out.": "connections.error.relay.status.timeout",
  "Could not connect relay environment.": "connections.error.relay.connect.failed",
  "Relay environment connection timed out.": "connections.error.relay.connect.timeout",
  "Could not register relay mobile device.": "connections.error.relay.registerDevice.failed",
  "Relay mobile device registration timed out.": "connections.error.relay.registerDevice.timeout",
  "Could not unregister relay mobile device.": "connections.error.relay.unregisterDevice.failed",
  "Relay mobile device unregistration timed out.":
    "connections.error.relay.unregisterDevice.timeout",
  "Could not register relay live activity.": "connections.error.relay.liveActivity.failed",
  "Relay Live Activity registration timed out.": "connections.error.relay.liveActivity.timeout",
  "Could not read relay agent activity snapshot.": "connections.error.relay.agentActivity.failed",
  "Relay agent activity snapshot timed out.": "connections.error.relay.agentActivity.timeout",
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
const patterns: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Connection profile (?<id>[\s\S]+) is unavailable\.$/u, "connections.error.profileMissing"],
  [
    /^Connection credential (?<id>[\s\S]+) is unavailable\.$/u,
    "connections.error.credentialMissing",
  ],
  [
    /^Connected environment (?<actual>\S+) does not match (?<expected>\S+)\.$/u,
    "connections.error.environmentMismatch",
  ],
  [
    /^Connection profile (?<id>[\s\S]+) is not a bearer connection\.$/u,
    "connections.error.profileNotBearer",
  ],
  [
    /^Connection profile (?<id>[\s\S]+) is not an SSH connection\.$/u,
    "connections.error.profileNotSsh",
  ],
  [/^(?<label>[\s\S]+) did not answer on any saved route\.$/u, "connections.error.noRoute"],
  [
    /^Could not prepare the SSH environment: (?<diagnostic>[\s\S]*)$/u,
    "connections.error.sshPrepare",
  ],
  [
    /^Could not disconnect the SSH environment: (?<diagnostic>[\s\S]*)$/u,
    "connections.error.sshDisconnect",
  ],
  [
    /^Could not load the desktop primary credential: (?<diagnostic>[\s\S]*)$/u,
    "connections.error.primaryCredential",
  ],
  [
    /^Desktop-local backend (?<id>[\s\S]+) is not ready yet\.$/u,
    "connections.error.backendNotReady",
  ],
  [
    /^That host reaches (?<label>[\s\S]+), a different machine\. Add it as its own environment instead\.$/u,
    "connections.error.differentHost",
  ],
  [
    /^This client is not supported by this server\. Update your app or use a compatible release to connect to (?<label>[\s\S]+)\.$/u,
    "connections.error.updateClient",
  ],
  [
    /^This client requires a newer server\. Update T3 Code on (?<label>[\s\S]+) to connect\.$/u,
    "connections.error.updateServer",
  ],
  [
    /^Relay rejected the environment link proof \((?<reason>[\s\S]*)\)\.$/u,
    "connections.error.relayInvalidLinkProof",
  ],
  [
    /^Relay rejected the environment connection request \((?<reason>[\s\S]*)\)\.$/u,
    "connections.error.relayConnectReason",
  ],
  [
    /^Relay could not reach the environment endpoint \((?<reason>[\s\S]*)\)\.$/u,
    "connections.error.relayEndpointUnavailable",
  ],
  [
    /^Relay could not link the environment \((?<reason>[\s\S]*)\)\.$/u,
    "connections.error.relayLinkFailed",
  ],
  [
    /^Relay cannot provision the managed endpoint \((?<reason>[\s\S]*)\)\.$/u,
    "connections.error.relayLinkUnavailable",
  ],
  [
    /^Relay rejected the agent activity publish proof \((?<reason>[\s\S]*)\)\.$/u,
    "connections.error.relayInvalidActivityProof",
  ],
  [
    /^Relay encountered an internal error \((?<reason>[\s\S]*)\)\.$/u,
    "connections.error.relayInternal",
  ],
];

/** Translate connection-owned messages without changing wire errors or unknown diagnostics. */
export function formatConnectionErrorMessage(message: string, t?: TFunction): string {
  if (!t) return message;
  for (const [suffix, key] of connectionErrorSuffixes) {
    if (message.endsWith(suffix)) {
      return `${formatConnectionErrorMessage(message.slice(0, -suffix.length), t)} ${t(key)}`;
    }
  }
  const key = fixedMessages[message];
  if (key !== undefined) return t(key);

  for (const [pattern, key] of patterns) {
    const match = pattern.exec(message);
    if (match?.groups) return t(key, match.groups);
  }
  const tunnelLimit =
    /^Relay refused the link: this account already has its maximum of (\d+) managed tunnels\. Unlink an environment to free one up\.$/u.exec(
      message,
    );
  if (tunnelLimit)
    return t("connections.error.relayLinkLimit", {
      count: Number(tunnelLimit[1]),
      maximum: tunnelLimit[1],
    });

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
