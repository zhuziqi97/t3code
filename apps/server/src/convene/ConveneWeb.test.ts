import { assert, it } from "@effect/vitest";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Socket from "effect/socket/Socket";
import {
  FetchHttpClient,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import * as ServerConfig from "../config.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ConveneWeb from "./ConveneWeb.ts";

it.live(
  "forwards HTTP bytes and WebSocket frames through native authentication and releases its session",
  () =>
    Effect.gen(function* () {
      const configContext = yield* Layer.build(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-convene-web-test-" }),
      );
      const authLayer = EnvironmentAuth.layer.pipe(
        Layer.provideMerge(SqlitePersistence.layerMemory),
        Layer.provide(ServerSecretStore.layer),
        Layer.provide(ServerEnvironment.layerIdentity),
        Layer.provide(Layer.succeedContext(configContext)),
      );
      const routes = Layer.mergeAll(
        HttpRouter.add(
          "POST",
          "/api/upload",
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const auth = yield* EnvironmentAuth.EnvironmentAuth;
            const principal = yield* auth.authenticateHttpRequest(request);
            assert.equal(principal.subject, "convene-web");
            assert.equal(request.headers.cookie, undefined);
            assert.equal(request.headers["content-type"], "application/octet-stream");
            assert.equal(
              new URL(request.url, "http://native").searchParams.get("name"),
              "native file",
            );
            return HttpServerResponse.uint8Array(new Uint8Array(yield* request.arrayBuffer), {
              status: 201,
            });
          }),
        ),
        HttpRouter.add(
          "GET",
          "/ws",
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const auth = yield* EnvironmentAuth.EnvironmentAuth;
            yield* auth.authenticateWebSocketUpgrade(request, "rpc");
            const socket = yield* request.upgrade;
            const writer = yield* socket.writer;
            const reader = yield* socket.reader;
            for (let received = 0; received < 2;)
              for (const frame of yield* reader.pull) {
                yield* writer.write(frame);
                received++;
              }
            yield* writer.write(new Socket.CloseEvent(4004, "native close"));
            return HttpServerResponse.empty();
          }),
        ),
      );
      const nativeContext = yield* Layer.build(
        HttpRouter.serve(routes, { disableListenLog: true }).pipe(
          Layer.provideMerge(authLayer),
          Layer.provideMerge(NodeHttpServer.layerTest),
        ),
      );
      const auth = Context.get(nativeContext, EnvironmentAuth.EnvironmentAuth);
      const server = Context.get(nativeContext, HttpServer.HttpServer);
      if (server.address._tag === "UnixPathAddress")
        return yield* Effect.die("Expected TCP test server");
      const webLayer = ConveneWeb.layer.pipe(
        Layer.provide(Layer.succeed(EnvironmentAuth.EnvironmentAuth, auth)),
        Layer.provide(Layer.succeed(HttpServer.HttpServer, server)),
        Layer.provide(FetchHttpClient.layer),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const webContext = yield* Layer.build(webLayer);
          const web = Context.get(webContext, ConveneWeb.ConveneWeb);
          const bytes = new Uint8Array([0, 1, 127, 128, 255]);
          for (let repeat = 0; repeat < 2; repeat++) {
            const response = yield* web.http({
              method: "POST",
              path: "/api/upload?name=native+file",
              headers: [
                ["cookie", "platform-cookie=private"],
                ["authorization", "Bearer platform-token"],
                ["Content-Type", "application/octet-stream"],
              ],
              body: Stream.make(bytes),
            });
            assert.equal(response.status, 201);
            assert.deepEqual(new Uint8Array(yield* response.arrayBuffer), bytes);
          }
          const sessions = yield* auth.listSessions();
          assert.equal(sessions.length, 1);
          assert.equal(sessions[0]?.subject, "convene-web");
          const socket = yield* web.websocket("/ws", null);
          const reader = yield* socket.reader;
          const writer = yield* socket.writer;
          yield* writer.write("native text");
          assert.deepEqual(yield* reader.pull, ["native text"]);
          yield* writer.write(bytes);
          assert.deepEqual(yield* reader.pull, [bytes]);
          const closed = yield* Effect.flip(reader.pull);
          assert.equal(closed.reason._tag, "SocketCloseError");
          if (closed.reason._tag === "SocketCloseError") assert.equal(closed.reason.code, 4004);
        }),
      );
      assert.deepEqual(yield* auth.listSessions(), []);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
