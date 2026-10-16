import { assert, it } from "@effect/vitest";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { FetchHttpClient, HttpRouter, HttpServer, HttpServerRequest } from "effect/http";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as EventStore from "../persistence/OrchestrationEventStore.ts";
import * as ConveneConfiguration from "./ConveneConfiguration.ts";
import * as ConveneConnection from "./ConveneConnection.ts";
import * as ConveneMcp from "./ConveneMcp.ts";
import * as ConveneNative from "./ConveneNative.ts";
import * as ConvenePlatform from "./ConvenePlatform.ts";
import * as ConveneWorkspaces from "./ConveneWorkspaces.ts";

const decode = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

it.live("opens a data channel while a configuration cache write is waiting", () =>
  Effect.gen(function* () {
    const cacheStarted = yield* Deferred.make<void>();
    const releaseCache = yield* Deferred.make<void>();
    const dataBound = yield* Deferred.make<void>();
    const routes = Layer.mergeAll(
      HttpRouter.add(
        "GET",
        "/api/v1/execution-runners/ws",
        Effect.gen(function* () {
          const socket = yield* (yield* HttpServerRequest.HttpServerRequest).upgrade;
          const { pull } = yield* socket.reader;
          const writer = yield* socket.writer;
          const send = (message: object) => writer.write(JSON.stringify(message));
          while (true)
            for (const frame of yield* pull) {
              const message = yield* decode(frame);
              if (message.TYPE === "HELLO")
                yield* send({ TYPE: "HELLO_ACK", PAYLOAD: { HEARTBEAT_INTERVAL_SECONDS: 15 } });
              if (message.TYPE === "TARGETS_REPORT") {
                yield* send({
                  TYPE: "TARGETS_REPORT_ACK",
                  PAYLOAD: { REPORT_ID: message.MESSAGE_ID, CONFIGURATIONS: [] },
                });
                yield* Deferred.await(cacheStarted);
                yield* send({
                  TYPE: "OPEN_DATA_CHANNEL",
                  REQUEST_ID: "read",
                  CONNECTION_ID: "control",
                  KIND: "HTTP",
                });
                return yield* Effect.never;
              }
            }
        }),
      ),
      HttpRouter.add(
        "GET",
        "/api/v1/execution-runners/data",
        Effect.gen(function* () {
          const socket = yield* (yield* HttpServerRequest.HttpServerRequest).upgrade;
          const { pull } = yield* socket.reader;
          while (true)
            for (const frame of yield* pull) {
              if ((yield* decode(frame)).TYPE === "BIND_DATA_CHANNEL") {
                yield* Deferred.succeed(dataBound, undefined);
                return yield* Effect.never;
              }
            }
        }),
      ),
    );
    const serverContext = yield* Layer.build(
      HttpRouter.serve(routes, { disableListenLog: true }).pipe(
        Layer.provideMerge(NodeHttpServer.layerTest),
      ),
    );
    const server = Context.get(serverContext, HttpServer.HttpServer);
    const dependencies = Layer.mergeAll(
      Layer.succeed(HttpServer.HttpServer, server),
      FetchHttpClient.layer,
      Layer.mock(EnvironmentAuth.EnvironmentAuth)({ revokeSession: () => Effect.succeed(true) }),
      Layer.mock(ConvenePlatform.ConvenePlatform)({
        readConnection: Effect.succeed(
          Option.some({
            baseUrl: HttpServer.formatAddress(server.address),
            runnerId: "runner",
            refreshCredential: "credential",
          }),
        ),
        accessToken: Effect.succeed("access"),
        changes: yield* PubSub.unbounded<void>(),
      }),
      Layer.mock(ConveneMcp.ConveneMcp)({ configure: () => Effect.void }),
      Layer.mock(ProjectStore.ProjectStoreV2)({ list: () => Effect.succeed([]) }),
      Layer.mock(EventStore.OrchestrationEventStore)({
        latestApplicationSequence: Effect.succeed(0),
        streamApplicationEvents: () => Stream.empty,
      }),
      Layer.mock(ConveneWorkspaces.ConveneWorkspaces)({ list: () => Effect.succeed([]) }),
      Layer.mock(ConveneNative.ConveneNative)({}),
      Layer.mock(ConveneConfiguration.ConveneConfiguration)({
        record: () =>
          Deferred.succeed(cacheStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseCache)),
          ),
      }),
    );
    yield* Effect.gen(function* () {
      const connection = yield* ConveneConnection.ConveneConnection;
      yield* Deferred.await(dataBound);
      assert.equal((yield* connection.status).phase, "connecting");
      yield* Deferred.succeed(releaseCache, undefined);
      const online = yield* connection.changes.pipe(
        Stream.filter((s) => s.phase === "online"),
        Stream.take(1),
        Stream.runCollect,
      );
      assert.equal(online.length, 1);
    }).pipe(Effect.provide(ConveneConnection.layer.pipe(Layer.provide(dependencies))));
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-control-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
    Effect.scoped,
  ),
);
