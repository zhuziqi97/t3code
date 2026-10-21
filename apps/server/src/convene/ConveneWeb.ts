import { AuthStandardClientScopes } from "@t3tools/contracts";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Socket from "effect/socket/Socket";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpMethod,
  HttpServer,
} from "effect/http";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ConveneSocket from "./ConveneSocket.ts";

export class ConveneWebError extends Schema.TaggedError<ConveneWebError>()("ConveneWebError", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return "The native web connection failed.";
  }
}

export class ConveneWeb extends Context.Service<
  ConveneWeb,
  {
    readonly http: (input: {
      readonly method: HttpMethod.HttpMethod;
      readonly path: string;
      readonly headers: ReadonlyArray<readonly [string, string]>;
      readonly body: Stream.Stream<Uint8Array, Socket.SocketError | Schema.SchemaError>;
    }) => Effect.Effect<HttpClientResponse.HttpClientResponse, ConveneWebError>;
    readonly websocket: (
      path: string,
      protocol: string | null,
    ) => Effect.Effect<Socket.Socket, ConveneWebError, Scope.Scope>;
  }
>()("t3/convene/ConveneWeb") {}

const make = Effect.gen(function* () {
  const server = yield* HttpServer.HttpServer;
  if (server.address._tag === "UnixPathAddress")
    return yield* new ConveneWebError({
      cause: new Error("Convene Web requires the native TCP listener."),
    });
  const port = server.address.port;
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const http = yield* HttpClient.HttpClient;
  const lock = yield* Semaphore.make(1);
  let session: EnvironmentAuth.IssuedBearerSession | undefined;
  const credential = lock
    .withPermit(
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        if (session && DateTime.toEpochMillis(now) < DateTime.toEpochMillis(session.expiresAt))
          return session.token;
        if (session) yield* auth.revokeSession(session.sessionId);
        session = yield* auth.issueSession({
          subject: "convene-web",
          label: "Convene Web",
          scopes: AuthStandardClientScopes,
          ttl: Duration.hours(12),
        });
        return session.token;
      }),
    )
    .pipe(Effect.mapError((cause) => new ConveneWebError({ cause })));
  yield* Effect.addFinalizer(() =>
    session ? auth.revokeSession(session.sessionId).pipe(Effect.orDie) : Effect.void,
  );

  // A reverse route always terminates at this environment, regardless of the
  // browser's Host, Cookie, Authorization, or an absolute URL in its path.
  const localUrl = (path: string) => {
    const incoming = new URL(path, "http://native");
    const url = new URL(`http://127.0.0.1:${port}`);
    url.pathname = incoming.pathname;
    url.search = incoming.search;
    return url;
  };
  return ConveneWeb.of({
    http: Effect.fn("ConveneWeb.http")(function* (input) {
      const token = yield* credential;
      const headers = Object.fromEntries(
        input.headers
          .filter(
            ([key]) =>
              !["authorization", "cookie", "host", "content-length", "accept-encoding"].includes(
                key.toLowerCase(),
              ),
          )
          .map(([key, value]) => [key.toLowerCase(), value]),
      );
      let request = HttpClientRequest.make(input.method)(localUrl(input.path).toString()).pipe(
        HttpClientRequest.setHeaders(headers),
        HttpClientRequest.setHeader("authorization", `Bearer ${token}`),
        HttpClientRequest.setHeader("accept-encoding", "identity"),
      );
      if (input.method !== "GET" && input.method !== "HEAD")
        request = HttpClientRequest.bodyStream(request, input.body, {
          contentType: headers["content-type"],
        });
      return yield* http
        .execute(request)
        .pipe(Effect.mapError((cause) => new ConveneWebError({ cause })));
    }),
    websocket: Effect.fn("ConveneWeb.websocket")(function* (path, protocol) {
      const token = yield* credential;
      const url = localUrl(path);
      url.protocol = "ws:";
      const socket = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new NodeSocket.NodeWS.WebSocket(url, protocol ?? [], {
              headers: { authorization: `Bearer ${token}` },
            }),
        ),
        (socket) => Effect.sync(() => ConveneSocket.close(socket)),
      );
      return yield* ConveneSocket.make(socket);
    }),
  });
});

/** One native auth session belongs to one Convene control connection. */
export const layer = Layer.effect(ConveneWeb, make);
