import { ProjectId, type ConveneIntegrationError, type ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NetAddress from "effect/net/NetAddress";
import * as Schema from "effect/Schema";
import {
  HttpClient,
  HttpClientRequest,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  HttpRouter,
} from "effect/http";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ConvenePlatform from "./ConvenePlatform.ts";
import * as ConveneWorkspaces from "./ConveneWorkspaces.ts";
import type { McpHttpContribution } from "@t3tools/provider-core/server/mcpSession";

export class ConveneMcpError extends Schema.TaggedError<ConveneMcpError>()("ConveneMcpError", {
  category: Schema.Literals(["workspace_unavailable", "credential", "upstream"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Convene MCP failed (${this.category}).`;
  }
}

export class ConveneMcp extends Context.Service<
  ConveneMcp,
  {
    readonly configure: (
      configurations: ReadonlyArray<ConvenePlatform.Configuration>,
    ) => Effect.Effect<void>;
    readonly prepare: (
      threadId: ThreadId,
      providerSessionId: string,
    ) => Effect.Effect<Readonly<Record<string, McpHttpContribution>>, ConveneMcpError>;
    readonly rebindThread: (
      threadId: ThreadId,
      worktreePath: string | null,
    ) => Effect.Effect<void, ConveneMcpError>;
    readonly setSynchronizer: (
      synchronize: Effect.Effect<void, ConveneIntegrationError> | null,
    ) => Effect.Effect<void>;
    readonly release: (threadId: ThreadId, providerSessionId?: string) => Effect.Effect<void>;
    readonly forward: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<HttpServerResponse.HttpServerResponse, ConveneMcpError>;
  }
>()("t3/convene/ConveneMcp") {}

const make = Effect.gen(function* () {
  const platform = yield* ConvenePlatform.ConvenePlatform;
  const workspaces = yield* ConveneWorkspaces.ConveneWorkspaces;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const crypto = yield* Crypto.Crypto;
  const http = yield* HttpClient.HttpClient;
  const server = yield* HttpServer.HttpServer;
  const endpoint = NetAddress.isInetAddress(server.address)
    ? `http://${NetAddress.isUnspecified(server.address.address) ? "127.0.0.1" : NetAddress.formatUrlHostString(NetAddress.formatIp(server.address.address))}:${server.address.port}/convene/mcp`
    : "http://127.0.0.1/convene/mcp";
  let configurations: ReadonlyArray<ConvenePlatform.Configuration> = [];
  // The connection also serves native orchestration calls. Register its report waiter here
  // so startup can await it without making the orchestration layer depend on that connection.
  let synchronize: Effect.Effect<void, ConveneIntegrationError> = Effect.void;
  const leases = new Map<
    string,
    {
      threadId: ThreadId;
      providerSessionId: string;
      projectId: string;
      nativeProjectId: string;
      targetId: string;
      workspaceKey: string;
      workspacePath: string;
    }
  >();
  const credentials = new Map<
    string,
    {
      value: ConvenePlatform.Credential;
      nativeProjectId: string;
      target: ConvenePlatform.Configuration["targets"][number];
    }
  >();
  const credentialIdentityIsCurrent = (
    projectId: string,
    cached: NonNullable<ReturnType<typeof credentials.get>>,
  ) => {
    const config = configurations.find((entry) => entry.client_project_id === projectId);
    return (
      config?.mcp_enabled === true &&
      config.project.native_project_id === cached.nativeProjectId &&
      config.targets.some(
        (target) =>
          target.target_id === cached.target.target_id &&
          target.native_workspace_key === cached.target.native_workspace_key &&
          target.path === cached.target.path &&
          target.availability === "AVAILABLE",
      )
    );
  };

  const rebindThread = Effect.fn("ConveneMcp.rebindThread")(function* (
    threadId: ThreadId,
    worktreePath: string | null,
  ) {
    const thread = yield* projections
      .getThread(threadId)
      .pipe(
        Effect.mapError(
          (cause) => new ConveneMcpError({ category: "workspace_unavailable", cause }),
        ),
      );
    // A later explicit selection can supersede an older pending metadata effect.
    if (!thread || thread.worktreePath !== worktreePath) return;
    const locations = yield* workspaces
      .list(thread.projectId)
      .pipe(
        Effect.mapError(
          (cause) => new ConveneMcpError({ category: "workspace_unavailable", cause }),
        ),
      );
    const target = locations.find(
      (location) =>
        location.available &&
        (worktreePath === null ? location.key === "root" : location.path === worktreePath),
    );
    if (!target) return yield* new ConveneMcpError({ category: "workspace_unavailable" });
    const previousKey = yield* workspaces.threadKey(thread.projectId, threadId);
    const previous = locations.find((location) => location.key === previousKey);
    // Replaying a committed transition must not adopt a replacement checkout at its path.
    // That identity change still needs the explicit recovery selection.
    if (previous && previous.path === target.path && previous.key !== target.key)
      return yield* new ConveneMcpError({ category: "workspace_unavailable" });
    yield* workspaces
      .rebindThread(thread.projectId, threadId, target.key)
      .pipe(
        Effect.mapError(
          (cause) => new ConveneMcpError({ category: "workspace_unavailable", cause }),
        ),
      );
    yield* synchronize.pipe(
      Effect.mapError((cause) => new ConveneMcpError({ category: "workspace_unavailable", cause })),
    );
  });

  const prepare = Effect.fn("ConveneMcp.prepare")(function* (
    threadId: ThreadId,
    providerSessionId: string,
  ) {
    const thread = yield* projections
      .getThread(threadId)
      .pipe(
        Effect.mapError(
          (cause) => new ConveneMcpError({ category: "workspace_unavailable", cause }),
        ),
      );
    if (!thread) return {};
    const config = configurations.find(
      (config) => config.project.native_project_id === thread.projectId,
    );
    if (!config || !config.mcp_enabled) return {};
    const workspaceKey = yield* workspaces.threadKey(thread.projectId, threadId);
    const locations = yield* workspaces
      .list(thread.projectId)
      .pipe(
        Effect.mapError(
          (cause) => new ConveneMcpError({ category: "workspace_unavailable", cause }),
        ),
      );
    const workspace = locations.find(
      (location) =>
        location.available &&
        (thread.worktreePath === null
          ? location.key === "root"
          : location.path === thread.worktreePath),
    );
    if (!workspace || (workspaceKey !== null && workspace.key !== workspaceKey))
      return yield* new ConveneMcpError({ category: "workspace_unavailable" });
    const target = config.targets.find(
      (target) =>
        target.availability === "AVAILABLE" &&
        target.native_workspace_key === workspace.key &&
        (target.path === null || target.path === workspace.path),
    );
    if (!target) return yield* new ConveneMcpError({ category: "workspace_unavailable" });
    yield* workspaces
      .rememberThread(thread.projectId, threadId, target.native_workspace_key)
      .pipe(
        Effect.mapError(
          (cause) => new ConveneMcpError({ category: "workspace_unavailable", cause }),
        ),
      );
    const existing = [...leases].find(
      ([, lease]) =>
        lease.threadId === threadId &&
        lease.providerSessionId === providerSessionId &&
        lease.projectId === config.client_project_id &&
        lease.targetId === target.target_id,
    );
    const token =
      existing?.[0] ??
      Buffer.from(
        yield* crypto
          .randomBytes(32)
          .pipe(Effect.mapError((cause) => new ConveneMcpError({ category: "credential", cause }))),
      ).toString("base64url");
    leases.set(token, {
      threadId,
      providerSessionId,
      projectId: config.client_project_id,
      nativeProjectId: config.project.native_project_id,
      targetId: target.target_id,
      workspaceKey: workspace.key,
      workspacePath: workspace.path,
    });
    return { convene: { endpoint, authorizationHeader: `Bearer ${token}` } };
  });

  const forward = Effect.fn("ConveneMcp.forward")(function* (
    request: HttpServerRequest.HttpServerRequest,
  ) {
    const authorization = request.headers.authorization;
    const lease = authorization?.startsWith("Bearer ")
      ? leases.get(authorization.slice(7))
      : undefined;
    if (!lease) return HttpServerResponse.empty({ status: 401 });
    const config = configurations.find((config) => config.client_project_id === lease.projectId);
    const threadKey =
      config === undefined
        ? null
        : yield* workspaces.threadKey(
            ProjectId.make(config.project.native_project_id),
            lease.threadId,
          );
    if (
      !config?.mcp_enabled ||
      config.project.native_project_id !== lease.nativeProjectId ||
      threadKey !== lease.workspaceKey ||
      !config.targets.some(
        (target) =>
          target.target_id === lease.targetId &&
          target.native_workspace_key === lease.workspaceKey &&
          (target.path === null || target.path === lease.workspacePath) &&
          target.availability === "AVAILABLE",
      )
    )
      return HttpServerResponse.empty({ status: 403 });
    const now = yield* Clock.currentTimeMillis;
    let credential = credentials.get(lease.projectId)?.value;
    if (!credential || Date.parse(credential.expires_at) <= now + 30_000) {
      credential = yield* platform
        .credential(lease.projectId, lease.targetId)
        .pipe(Effect.mapError((cause) => new ConveneMcpError({ category: "credential", cause })));
      const cached = {
        value: credential,
        nativeProjectId: config.project.native_project_id,
        target: config.targets.find((target) => target.target_id === lease.targetId)!,
      };
      // Configuration may change while a credential request is in flight.
      if (!credentialIdentityIsCurrent(lease.projectId, cached))
        return HttpServerResponse.empty({ status: 403 });
      credentials.set(lease.projectId, cached);
    }
    const forwardedHeaders = Object.fromEntries(
      [
        "accept",
        "content-type",
        "mcp-session-id",
        "mcp-protocol-version",
        "mcp-method",
        "mcp-name",
        "last-event-id",
      ].flatMap((name) =>
        request.headers[name] === undefined ? [] : [[name, request.headers[name]]],
      ),
    );
    let outgoing = HttpClientRequest.make(request.method)(credential.mcp_url).pipe(
      HttpClientRequest.setHeaders(forwardedHeaders),
      HttpClientRequest.setHeader("Authorization", `Bearer ${credential.access_token}`),
    );
    if (request.method === "POST")
      outgoing = HttpClientRequest.bodyStream(outgoing, request.stream, {
        contentType: request.headers["content-type"],
      });
    const upstream = yield* http
      .execute(outgoing)
      .pipe(Effect.mapError((cause) => new ConveneMcpError({ category: "upstream", cause })));
    // An invalid JWT is renewed on the next caller's request; never replay a write.
    if (upstream.status === 401 && credentials.get(lease.projectId)?.value === credential)
      credentials.delete(lease.projectId);
    return HttpServerResponse.stream(upstream.stream, {
      status: upstream.status,
      headers: Object.fromEntries(
        ["content-type", "mcp-session-id"].flatMap((name) =>
          upstream.headers[name] === undefined ? [] : [[name, upstream.headers[name]]],
        ),
      ),
    });
  });
  return ConveneMcp.of({
    prepare,
    forward,
    rebindThread,
    setSynchronizer: Effect.fn("ConveneMcp.setSynchronizer")((next) =>
      Effect.sync(() => {
        synchronize = next ?? Effect.void;
      }),
    ),
    configure: Effect.fn("ConveneMcp.configure")((next) =>
      Effect.sync(() => {
        configurations = next;
        for (const [projectId, cached] of credentials)
          if (!credentialIdentityIsCurrent(projectId, cached)) credentials.delete(projectId);
      }),
    ),
    release: Effect.fn("ConveneMcp.release")((threadId, providerSessionId) =>
      Effect.sync(() => {
        for (const [token, lease] of leases)
          if (
            lease.threadId === threadId &&
            (providerSessionId === undefined || lease.providerSessionId === providerSessionId)
          )
            leases.delete(token);
      }),
    ),
  });
});

export const layer = Layer.effect(ConveneMcp, make);
export const route = HttpRouter.add(
  "*",
  "/convene/mcp",
  Effect.gen(function* () {
    const broker = yield* ConveneMcp;
    const request = yield* HttpServerRequest.HttpServerRequest;
    return yield* broker.forward(request).pipe(
      Effect.catchTags({
        ConveneMcpError: (error) =>
          Effect.logWarning("Convene MCP forwarding failed", error).pipe(
            Effect.as(HttpServerResponse.empty({ status: 502 })),
          ),
      }),
    );
  }),
);
