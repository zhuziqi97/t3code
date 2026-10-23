import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {
  AuthFilesystemWriteScope,
  AuthTerminalOperateScope,
  ConveneIdeRequest,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Socket from "effect/socket/Socket";
import {
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
} from "effect/http";

import { authenticateMediaRequest, failEnvironmentScopeRequired } from "../auth/http.ts";
import * as ConveneIde from "./ConveneIde.ts";

const decodeRequest = Schema.decodeUnknownEffect(ConveneIdeRequest);
const droppedHeaders = new Set([
  "authorization",
  "cookie",
  "dpop",
  "host",
  "content-length",
  "connection",
  "upgrade",
  "accept-encoding",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
  "sec-websocket-protocol",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-prefix",
]);

const requireIdeAccess = Effect.gen(function* () {
  const session = yield* authenticateMediaRequest(AuthFilesystemWriteScope);
  if (!session.scopes.includes(AuthTerminalOperateScope)) {
    return yield* failEnvironmentScopeRequired(AuthTerminalOperateScope);
  }
});

const errorResponse = (error: ConveneIde.ConveneIdeError, proxy = false) =>
  HttpServerResponse.jsonUnsafe(
    { code: error.code },
    {
      status:
        error.code === "internal_error"
          ? 500
          : error.code === "workspace_unavailable"
            ? 404
            : error.code === "runtime_unavailable"
              ? proxy
                ? 503
                : 409
              : 400,
      headers: { "cache-control": "no-store" },
    },
  );

const handleManagement = Effect.gen(function* () {
  yield* requireIdeAccess;
  const ide = yield* ConveneIde.ConveneIde;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const input = yield* request.json.pipe(
    Effect.flatMap(decodeRequest),
    Effect.mapError((cause) => new ConveneIde.ConveneIdeError({ code: "invalid_request", cause })),
  );
  return HttpServerResponse.jsonUnsafe(yield* ide.handle(input), {
    headers: { "cache-control": "no-store" },
  });
}).pipe(
  Effect.catchTags({
    ConveneIdeError: (error) => Effect.succeed(errorResponse(error)),
    EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
    EnvironmentInternalError: HttpServerRespondable.toResponse,
    EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
  }),
);

const pump =
  // A bridge has one request span; tracing each terminal or editor frame would be excessive.
  Effect.fnUntraced(function* (source: Socket.Socket, target: Socket.Writer) {
    const { pull } = yield* source.reader;
    while (true) yield* target.writeAll(yield* pull);
  });

const proxyWebSocket = Effect.fn("ConveneIdeHttp.websocket")(function* (
  request: HttpServerRequest.HttpServerRequest,
  upstreamUrl: URL,
) {
  upstreamUrl.protocol = "ws:";
  const client = yield* request.upgrade;
  const upstream = yield* Socket.makeWebSocket(upstreamUrl.toString(), {
    openTimeout: "10 seconds",
  }).pipe(Effect.provide(NodeSocket.layerWebSocketConstructor));
  const clientWriter = yield* client.writer;
  const upstreamWriter = yield* upstream.writer;
  yield* Effect.raceFirst(pump(client, upstreamWriter), pump(upstream, clientWriter)).pipe(
    Effect.ignoreCause,
  );
  return HttpServerResponse.empty();
});

const proxyHttp = Effect.fn("ConveneIdeHttp.http")(function* (
  request: HttpServerRequest.HttpServerRequest,
  upstreamUrl: URL,
  prefix: string,
) {
  const http = HttpClient.withScope(yield* HttpClient.HttpClient);
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(
      ([name, value]) => value !== undefined && !droppedHeaders.has(name),
    ),
  );
  if (request.headers.origin !== undefined) headers.origin = upstreamUrl.origin;
  let outbound = HttpClientRequest.make(request.method)(upstreamUrl.toString()).pipe(
    HttpClientRequest.setHeaders(headers),
    HttpClientRequest.setHeader("accept-encoding", "identity"),
  );
  if (request.method !== "GET" && request.method !== "HEAD") {
    outbound = HttpClientRequest.bodyStream(outbound, request.stream, {
      contentType: request.headers["content-type"],
    });
  }
  const response = yield* http.execute(outbound);
  const forwarded: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers)) {
    if (
      value === undefined ||
      ["set-cookie", "transfer-encoding", "connection", "content-encoding"].includes(name)
    )
      continue;
    if (name === "location") {
      if (value.startsWith("/") && !value.startsWith("//")) forwarded[name] = prefix + value;
      else if (value.startsWith(upstreamUrl.origin + "/"))
        forwarded[name] = prefix + value.slice(upstreamUrl.origin.length);
      else forwarded[name] = value;
    } else forwarded[name] = value;
  }
  return HttpServerResponse.stream(response.stream, {
    status: response.status,
    headers: forwarded,
    ...(forwarded["content-type"] ? { contentType: forwarded["content-type"] } : {}),
  });
});

const handleRuntime = Effect.gen(function* () {
  yield* requireIdeAccess;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const parsed = HttpServerRequest.toURL(request);
  if (Option.isNone(parsed)) return HttpServerResponse.empty({ status: 400 });
  const match = /^\/api\/convene\/ide\/code-server\/([^/]+)(\/.*)?$/.exec(parsed.value.pathname);
  if (!match) return HttpServerResponse.empty({ status: 404 });
  const ide = yield* ConveneIde.ConveneIde;
  const origin = yield* ide.upstream(match[1]!);
  const upstreamUrl = new URL(origin);
  upstreamUrl.pathname = match[2] ?? "/";
  upstreamUrl.search = parsed.value.search;
  upstreamUrl.searchParams.delete("wsTicket");
  return yield* Effect.gen(function* () {
    if (request.headers.upgrade?.toLowerCase() === "websocket") {
      return yield* proxyWebSocket(request, upstreamUrl);
    }
    return yield* proxyHttp(request, upstreamUrl, ConveneIde.RUNTIME_PREFIX + match[1]!);
  }).pipe(
    Effect.orElseSucceed(() =>
      HttpServerResponse.text("IDE connection unavailable", { status: 502 }),
    ),
  );
}).pipe(
  Effect.catchTags({
    ConveneIdeError: (error) => Effect.succeed(errorResponse(error, true)),
    EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
    EnvironmentInternalError: HttpServerRespondable.toResponse,
    EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
  }),
);

export const layer = Layer.merge(
  HttpRouter.add("POST", ConveneIde.MANAGEMENT_PATH, handleManagement),
  HttpRouter.add("*", `${ConveneIde.RUNTIME_PREFIX}*`, handleRuntime),
);
