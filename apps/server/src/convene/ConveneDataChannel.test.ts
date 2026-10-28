import { assert, it } from "@effect/vitest";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import * as Schema from "effect/Schema";
import * as Socket from "effect/socket/Socket";
import {
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import * as ConveneDataChannel from "./ConveneDataChannel.ts";
import * as ConveneNative from "./ConveneNative.ts";
import * as ConvenePlatform from "./ConvenePlatform.ts";
import * as ConveneWeb from "./ConveneWeb.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeJsonRecord = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

it.live("relays native WebSocket text, binary and close reason", () =>
  Effect.gen(function* () {
    const completed = yield* Deferred.make<void>();
    const bytes = new Uint8Array(3 * 1024 * 1024).fill(197);
    const routes = Layer.mergeAll(
      HttpRouter.add(
        "GET",
        "/native-ws",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const socket = yield* request.upgrade;
          const writer = yield* socket.writer;
          const reader = yield* socket.reader;
          let count = 0;
          while (count < 3)
            for (const frame of yield* reader.pull) {
              yield* writer.write(frame);
              count++;
            }
          yield* writer.write(new Socket.CloseEvent(1011, "native close reason"));
          return HttpServerResponse.empty();
        }),
      ),
      HttpRouter.add(
        "GET",
        "/api/v1/execution-runners/data",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const socket = yield* request.upgrade;
          const reader = yield* socket.reader;
          const writer = yield* socket.writer;
          const send = (value: object) =>
            encodeJson(value).pipe(Effect.flatMap((text) => writer.writeAll([text])));
          let accepted = false;
          while (!accepted)
            for (const frame of yield* reader.pull) {
              const message = yield* decodeJsonRecord(frame);
              if (message.TYPE === "BIND_DATA_CHANNEL")
                yield* send({ TYPE: "WS_OPEN", PATH: "/native-ws", PROTOCOL: null, ACCESS: "WEB" });
              if (message.TYPE === "WS_ACCEPT") accepted = true;
            }
          yield* writer.writeAll(["native text", bytes, ""]);
          const frames: Array<string | Uint8Array> = [];
          while (frames.length < 3) frames.push(...(yield* reader.pull));
          assert.deepEqual(frames, ["native text", bytes, ""]);
          const closed = yield* Effect.flip(reader.pull);
          assert.equal(closed.reason._tag, "SocketCloseError");
          if (closed.reason._tag === "SocketCloseError") {
            assert.equal(closed.reason.code, 1011);
            assert.equal(closed.reason.closeReason, "native close reason");
          }
          yield* Deferred.succeed(completed, undefined);
          return HttpServerResponse.empty();
        }),
      ),
    );
    const services = yield* Layer.build(
      HttpRouter.serve(routes, { disableListenLog: true }).pipe(
        Layer.provideMerge(NodeHttpServer.layerTest),
      ),
    );
    const server = Context.get(services, HttpServer.HttpServer);
    const base = HttpServer.formatAddress(server.address);
    const dependencies = Layer.mergeAll(
      Layer.mock(ConvenePlatform.ConvenePlatform)({
        changes: yield* PubSub.unbounded<void>(),
        readConnection: Effect.succeedNone,
        accessToken: Effect.succeed("device-access"),
        beginPairing: () => Effect.die("unused"),
        finishPairing: () => Effect.die("unused"),
        disconnect: Effect.void,
        credential: () => Effect.die("unused"),
      }),
      Layer.succeed(ConveneNative.ConveneNative, {
        handle: () => Effect.die("Web cannot reach module RPC"),
      }),
      Layer.succeed(ConveneWeb.ConveneWeb, {
        http: () => Effect.die("unused"),
        websocket: (path) =>
          Socket.makeWebSocket(base.replace("http:", "ws:") + path).pipe(
            Effect.provide(NodeSocket.layerWebSocketConstructorWS),
          ),
      }),
    );
    const running = yield* ConveneDataChannel.open(base, {
      TYPE: "OPEN_DATA_CHANNEL",
      REQUEST_ID: "owned",
      CONNECTION_ID: "owned",
      KIND: "WS",
    }).pipe(Effect.provide(dependencies), Effect.forkScoped);
    yield* Deferred.await(completed);
    yield* Fiber.join(running);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.live("finishes concurrent Web resource responses including HEAD, 204 and 304", () =>
  Effect.gen(function* () {
    const scenarios = Array.from({ length: 40 }, (_, index) => ({
      index,
      status: index === 1 ? 204 : index === 2 ? 304 : 200,
      method: index === 0 ? ("HEAD" as const) : ("GET" as const),
      bytes: new Uint8Array(index === 38 ? 256 * 1024 : index % 2 === 0 ? 4585 : 627).fill(index),
      completed: Deferred.makeUnsafe<Uint8Array>(),
    }));
    const route = HttpRouter.add(
      "GET",
      "/api/v1/execution-runners/data",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const socket = yield* request.upgrade;
        const { pull } = yield* socket.reader;
        const writer = yield* socket.writer;
        const send = (value: object) =>
          encodeJson(value).pipe(Effect.flatMap((text) => writer.writeAll([text])));
        let scenario = scenarios[0]!;
        const bytes: Array<Uint8Array> = [];
        while (true)
          for (const frame of yield* pull) {
            if (frame instanceof Uint8Array) {
              assert.isAtMost(frame.length, 48 * 1024);
              bytes.push(frame);
              continue;
            }
            const message = yield* decodeJsonRecord(frame);
            if (message.TYPE === "BIND_DATA_CHANNEL") {
              scenario = scenarios[Number(message.REQUEST_ID)]!;
              yield* send({
                TYPE: "HTTP_OPEN",
                METHOD: scenario.method,
                PATH: `/asset/${scenario.index}`,
                HEADERS: [],
                ACCESS: "WEB",
              });
            } else if (message.TYPE === "HTTP_RESPONSE") {
              assert.equal(message.STATUS, scenario.status);
            } else if (message.TYPE === "HTTP_DONE") {
              // GET may respond before the platform's upload direction ends.
              yield* send({ TYPE: "HTTP_END" });
              yield* Deferred.succeed(scenario.completed, new Uint8Array(Buffer.concat(bytes)));
              return HttpServerResponse.empty();
            }
          }
      }),
    );
    const services = yield* Layer.build(
      HttpRouter.serve(route, { disableListenLog: true }).pipe(
        Layer.provideMerge(NodeHttpServer.layerTest),
      ),
    );
    const server = Context.get(services, HttpServer.HttpServer);
    const dependencies = Layer.mergeAll(
      Layer.mock(ConvenePlatform.ConvenePlatform)({
        changes: yield* PubSub.unbounded<void>(),
        readConnection: Effect.succeedNone,
        accessToken: Effect.succeed("device-access"),
        beginPairing: () => Effect.die("unused"),
        finishPairing: () => Effect.die("unused"),
        disconnect: Effect.void,
        credential: () => Effect.die("unused"),
      }),
      Layer.succeed(ConveneNative.ConveneNative, {
        handle: () => Effect.die("Web cannot reach module RPC"),
      }),
      Layer.succeed(ConveneWeb.ConveneWeb, {
        http: (input) =>
          Effect.sync(() => {
            const scenario = scenarios[Number(input.path.split("/").at(-1))]!;
            return HttpClientResponse.fromWeb(
              HttpClientRequest.get("http://native"),
              new Response(
                scenario.method === "HEAD" || scenario.status === 204 || scenario.status === 304
                  ? null
                  : scenario.bytes,
                { status: scenario.status },
              ),
            );
          }),
        websocket: () => Effect.die("unused"),
      }),
    );
    yield* Effect.forEach(
      scenarios,
      (scenario) =>
        Effect.scoped(
          Effect.gen(function* () {
            const running = yield* ConveneDataChannel.open(
              HttpServer.formatAddress(server.address),
              {
                TYPE: "OPEN_DATA_CHANNEL",
                REQUEST_ID: String(scenario.index),
                CONNECTION_ID: "owned",
                KIND: "HTTP",
              },
            ).pipe(Effect.provide(dependencies), Effect.forkScoped);
            const actual = yield* Deferred.await(scenario.completed);
            assert.deepEqual(
              actual,
              scenario.method === "HEAD" || scenario.status === 204 || scenario.status === 304
                ? new Uint8Array()
                : scenario.bytes,
            );
            yield* Fiber.join(running);
          }),
        ),
      { concurrency: "unbounded", discard: true },
    );
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

it.live(
  "carries native JSON on the bound data socket and returns invalid commands without invoking native state",
  () =>
    Effect.gen(function* () {
      for (const scenario of ["valid", "invalid", "web"] as const) {
        const valid = scenario === "valid";
        const completed = yield* Deferred.make<{ status: number; result: unknown }>();
        let invoked = 0;
        const route = HttpRouter.add(
          "GET",
          "/api/v1/execution-runners/data",
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const socket = yield* request.upgrade;
            const { pull } = yield* socket.reader;
            const writer = yield* socket.writer;
            const send = (message: object) =>
              encodeJson(message).pipe(Effect.flatMap((text) => writer.writeAll([text])));
            let received = 0;
            let status = 0;
            const body: Array<Uint8Array> = [];
            while (true)
              for (const frame of yield* pull) {
                if (frame instanceof Uint8Array) {
                  body.push(frame);
                  continue;
                }
                if (typeof frame !== "string") continue;
                const message = yield* decodeJsonRecord(frame);
                if (received++ === 0) {
                  assert.deepEqual(message, { TYPE: "AUTHENTICATE", TOKEN: "device-access" });
                } else if (message.TYPE === "BIND_DATA_CHANNEL") {
                  assert.deepEqual(message, {
                    TYPE: "BIND_DATA_CHANNEL",
                    REQUEST_ID: "owned-request",
                    CONNECTION_ID: "owned-connection",
                  });
                  yield* send({
                    TYPE: "HTTP_OPEN",
                    METHOD: scenario === "web" ? "GET" : "POST",
                    PATH: scenario === "web" ? "/api/auth/session" : "/api/convene/native",
                    ACCESS: "NATIVE",
                    HEADERS: [["content-type", "application/json"]],
                  });
                  yield* writer.writeAll([
                    new TextEncoder().encode(
                      valid
                        ? '{"operation":"OPTIONS","projectId":"native:project","workspaceKey":"root"}'
                        : '{"operation":"UNKNOWN"}',
                    ),
                  ]);
                  yield* send({ TYPE: "HTTP_END" });
                } else if (message.TYPE === "HTTP_RESPONSE") {
                  status = Number(message.STATUS);
                } else if (message.TYPE === "HTTP_DONE") {
                  const result = yield* decodeJson(new TextDecoder().decode(Buffer.concat(body)));
                  yield* Deferred.succeed(completed, { status, result });
                  return HttpServerResponse.empty();
                }
              }
          }),
        );
        const services = yield* Layer.build(
          HttpRouter.serve(route, { disableListenLog: true }).pipe(
            Layer.provideMerge(NodeHttpServer.layerTest),
          ),
        );
        const server = Context.get(services, HttpServer.HttpServer);
        const dependencies = Layer.mergeAll(
          NodeServices.layer,
          Layer.succeed(ConveneWeb.ConveneWeb, {
            http: () => Effect.die("Module RPC must not reach native Web."),
            websocket: () => Effect.die("Module RPC must not reach native Web."),
          }),
          Layer.mock(ConvenePlatform.ConvenePlatform)({
            changes: yield* PubSub.unbounded<void>(),
            readConnection: Effect.succeedNone,
            accessToken: Effect.succeed("device-access"),
            beginPairing: () => Effect.die("unused"),
            finishPairing: () => Effect.die("unused"),
            disconnect: Effect.void,
            credential: () => Effect.die("unused"),
          }),
          Layer.succeed(ConveneNative.ConveneNative, {
            handle: (command) =>
              Effect.sync(() => {
                invoked++;
                assert.equal(command.projectId, "native:project");
                assert.equal(command.workspaceKey, "root");
                return { type: "options" as const, defaultModelSelection: null, providers: [] };
              }),
          }),
        );
        const running = yield* ConveneDataChannel.open(HttpServer.formatAddress(server.address), {
          TYPE: "OPEN_DATA_CHANNEL",
          REQUEST_ID: "owned-request",
          CONNECTION_ID: "owned-connection",
          KIND: "HTTP",
        }).pipe(Effect.provide(dependencies), Effect.forkScoped);
        const response = yield* Deferred.await(completed);
        assert.equal(response.status, valid ? 200 : scenario === "web" ? 404 : 400);
        assert.equal(invoked, valid ? 1 : 0);
        if (valid)
          assert.deepEqual(response.result, {
            type: "options",
            defaultModelSelection: null,
            providers: [],
          });
        yield* Fiber.join(running);
      }
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
