import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ConveneConfiguration from "./ConveneConfiguration.ts";
import * as ConveneConnection from "./ConveneConnection.ts";
import * as ConvenePlatform from "./ConvenePlatform.ts";
import * as ConveneSettings from "./ConveneSettings.ts";

it.effect(
  "waits without saving credentials, persists an approved pairing and preserves terminal platform errors",
  () => {
    let saved: Uint8Array | undefined;
    let reply: { status: number; body: unknown } = {
      status: 409,
      body: { error: { code: "RUNNER_PAIRING_PENDING" } },
    };
    const deps = Layer.mergeAll(
      Layer.succeed(
        ServerSecretStore.ServerSecretStore,
        ServerSecretStore.ServerSecretStore.of({
          get: () => Effect.succeed(saved ? Option.some(saved) : Option.none()),
          set: (_name, value) =>
            Effect.sync(() => {
              saved = value;
            }),
          create: () => Effect.die("not used"),
          getOrCreateRandom: () => Effect.die("not used"),
          remove: () =>
            Effect.sync(() => {
              saved = undefined;
            }),
        }),
      ),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() =>
            HttpClientResponse.fromWeb(
              request,
              new Response(JSON.stringify(reply.body), {
                status: reply.status,
                headers: { "content-type": "application/json" },
              }),
            ),
          ),
        ),
      ),
      Layer.succeed(ConveneConnection.ConveneConnection, {
        status: Effect.succeed({
          platformUrls: [],
          phase: "unpaired" as const,
          baseUrl: null,
          runnerId: null,
          error: null,
        }),
        changes: Stream.empty,
        synchronize: Effect.void,
      }),
      Layer.succeed(ConveneConfiguration.ConveneConfiguration, {
        record: () => Effect.void,
        clientProjectId: () => Effect.succeed(null),
        changes: Stream.empty,
        query: () => Effect.succeed({ configuration: null, fresh: true, error: null }),
        mutate: () => Effect.die("not used"),
        options: () => Effect.succeed({ items: [], total: 0, truncated: false }),
      }),
    );
    return Effect.gen(function* () {
      const settings = yield* ConveneSettings.ConveneSettings;
      const input = {
        operation: "exchange" as const,
        baseUrl: "http://localhost",
        deviceCode: "device",
      };
      assert.deepEqual(yield* settings.manage(input), { type: "pending" });
      assert.equal(saved, undefined);
      reply = {
        status: 200,
        body: { success: true, data: { runner_id: "runner", refresh_credential: "credential" } },
      };
      assert.equal((yield* settings.manage(input)).type, "status");
      assert.deepEqual(JSON.parse(new TextDecoder().decode(saved)), {
        baseUrl: "http://localhost",
        runnerId: "runner",
        refreshCredential: "credential",
      });
      reply = { status: 400, body: { error: { code: "RUNNER_PAIRING_EXPIRED" } } };
      assert.equal((yield* Effect.flip(settings.manage(input))).code, "RUNNER_PAIRING_EXPIRED");
    }).pipe(
      Effect.provide(
        ConveneSettings.layer.pipe(Layer.provideMerge(ConvenePlatform.layer), Layer.provide(deps)),
      ),
    );
  },
);
