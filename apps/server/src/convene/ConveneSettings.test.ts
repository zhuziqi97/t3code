import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ConveneManageInput } from "@t3tools/contracts";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ConveneConfiguration from "./ConveneConfiguration.ts";
import * as ConveneConnection from "./ConveneConnection.ts";
import * as ConvenePlatform from "./ConvenePlatform.ts";
import * as ConveneSettings from "./ConveneSettings.ts";

const decodeSavedConnection = Schema.decodeEffect(
  Schema.fromJsonString(ConvenePlatform.Connection),
);
const decodeManageInput = Schema.decodeEffect(ConveneManageInput);

function pairedSettingsFixture() {
  const original = {
    baseUrl: "http://legacy.example.test",
    runnerId: "existing-runner",
    refreshCredential: "synthetic-refresh",
  };
  let saved: ConvenePlatform.Connection | undefined = original;
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  const writes: ConvenePlatform.Connection[] = [];
  let respond: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<{ status: number; body: unknown }> = (request) =>
    Effect.succeed({
      status: 200,
      body: {
        success: true,
        data: { access_token: `synthetic-access:${new URL(request.url).host}`, expires_in: 3600 },
      },
    });
  const dependencies = Layer.mergeAll(
    Layer.succeed(ServerSecretStore.ServerSecretStore, {
      get: () =>
        Effect.sync(() =>
          saved ? Option.some(new TextEncoder().encode(JSON.stringify(saved))) : Option.none(),
        ),
      set: (_name, value) =>
        decodeSavedConnection(new TextDecoder().decode(value)).pipe(
          Effect.orDie,
          Effect.map((connection) => {
            saved = connection;
            writes.push(connection);
          }),
        ),
      create: () => Effect.die("not used"),
      getOrCreateRandom: () => Effect.die("not used"),
      remove: () =>
        Effect.sync(() => {
          saved = undefined;
        }),
    }),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.gen(function* () {
          requests.push(request);
          const reply = yield* respond(request);
          return HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify(reply.body), {
              status: reply.status,
              headers: { "content-type": "application/json" },
            }),
          );
        }),
      ),
    ),
    Layer.succeed(ConveneConnection.ConveneConnection, {
      status: Effect.sync(() => ({
        phase: "offline" as const,
        baseUrl: saved?.baseUrl ?? null,
        runnerId: saved?.runnerId ?? null,
        error: null,
        platformUrls: [],
      })),
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
  return {
    original,
    saved: () => saved,
    writes,
    requests,
    setResponse: (next: typeof respond) => {
      respond = next;
    },
    layer: ConveneSettings.layer.pipe(
      Layer.provideMerge(ConvenePlatform.layer),
      Layer.provide(dependencies),
    ),
  };
}

it.effect(
  "changes a paired address using the existing identity and a fresh destination token",
  () => {
    const fixture = pairedSettingsFixture();
    return Effect.gen(function* () {
      const platform = yield* ConvenePlatform.ConvenePlatform;
      const settings = yield* ConveneSettings.ConveneSettings;
      const notifications = yield* PubSub.subscribe(platform.changes);
      assert.equal(yield* platform.accessToken, "synthetic-access:legacy.example.test");
      yield* settings.manage(
        yield* decodeManageInput({
          operation: "change-address",
          baseUrl: " https://current.example.test/ ",
        }),
      );
      assert.deepEqual(fixture.saved(), {
        ...fixture.original,
        baseUrl: "https://current.example.test",
      });
      assert.equal(fixture.writes.length, 1);
      assert.equal(yield* PubSub.size(platform.changes), 1);
      yield* PubSub.take(notifications);
      assert.equal(yield* platform.accessToken, "synthetic-access:current.example.test");
      assert.deepEqual(
        fixture.requests.map((request) => request.url),
        [
          "http://legacy.example.test/api/v1/execution-runner-tokens/refresh",
          "https://current.example.test/api/v1/execution-runner-tokens/refresh",
        ],
      );
      const request = fixture.requests[1]!;
      assert.equal(request.body._tag, "Uint8Array");
      if (request.body._tag === "Uint8Array") {
        assert.deepEqual(JSON.parse(new TextDecoder().decode(request.body.body)), {
          refresh_credential: fixture.original.refreshCredential,
        });
      }
    }).pipe(Effect.scoped, Effect.provide(fixture.layer));
  },
);

it.effect(
  "keeps the previous address and cached access when the destination rejects the credential",
  () => {
    const fixture = pairedSettingsFixture();
    return Effect.gen(function* () {
      const platform = yield* ConvenePlatform.ConvenePlatform;
      const settings = yield* ConveneSettings.ConveneSettings;
      yield* PubSub.subscribe(platform.changes);
      assert.equal(yield* platform.accessToken, "synthetic-access:legacy.example.test");
      fixture.setResponse(() =>
        Effect.succeed({ status: 401, body: { error: { code: "RUNNER_CREDENTIAL_INVALID" } } }),
      );
      const error = yield* Effect.flip(
        settings.manage({ operation: "change-address", baseUrl: "https://current.example.test" }),
      );
      assert.equal(error.code, "RUNNER_CREDENTIAL_INVALID");
      assert.deepEqual(fixture.saved(), fixture.original);
      assert.equal(fixture.writes.length, 0);
      assert.equal(yield* PubSub.size(platform.changes), 0);
      assert.equal(yield* platform.accessToken, "synthetic-access:legacy.example.test");
      assert.equal(fixture.requests.length, 2);
    }).pipe(Effect.scoped, Effect.provide(fixture.layer));
  },
);

it.effect("does not persist or reconnect when a pending address change is cancelled", () => {
  const fixture = pairedSettingsFixture();
  return Effect.gen(function* () {
    const platform = yield* ConvenePlatform.ConvenePlatform;
    const settings = yield* ConveneSettings.ConveneSettings;
    const requested = yield* Deferred.make<void>();
    yield* PubSub.subscribe(platform.changes);
    fixture.setResponse(() =>
      Deferred.succeed(requested, undefined).pipe(Effect.andThen(Effect.never)),
    );
    const changing = yield* settings
      .manage({ operation: "change-address", baseUrl: "https://current.example.test" })
      .pipe(Effect.forkScoped);
    yield* Deferred.await(requested);
    yield* Fiber.interrupt(changing);
    assert.deepEqual(fixture.saved(), fixture.original);
    assert.equal(fixture.writes.length, 0);
    assert.equal(yield* PubSub.size(platform.changes), 0);
  }).pipe(Effect.scoped, Effect.provide(fixture.layer));
});

it.effect(
  "does not restore a pairing disconnected by another client during destination verification",
  () => {
    const fixture = pairedSettingsFixture();
    return Effect.gen(function* () {
      const platform = yield* ConvenePlatform.ConvenePlatform;
      const settings = yield* ConveneSettings.ConveneSettings;
      const requested = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      yield* platform.accessToken;
      fixture.setResponse((request) =>
        Effect.gen(function* () {
          if (new URL(request.url).host === "current.example.test") {
            yield* Deferred.succeed(requested, undefined);
            yield* Deferred.await(release);
          }
          return {
            status: 200,
            body: {
              success: true,
              data: { access_token: "synthetic-new-access", expires_in: 3600 },
            },
          };
        }),
      );
      const changing = yield* settings
        .manage({ operation: "change-address", baseUrl: "https://current.example.test" })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(requested);
      yield* settings.manage({ operation: "disconnect" });
      assert.equal(fixture.saved(), undefined);
      yield* Deferred.succeed(release, undefined);
      assert.equal((yield* Effect.flip(Fiber.join(changing))).code, "CONNECTION_CHANGED");
      assert.equal(fixture.saved(), undefined);
      assert.equal(fixture.writes.length, 0);
      assert.deepEqual(
        fixture.requests.map((request) => request.url),
        [
          "http://legacy.example.test/api/v1/execution-runner-tokens/refresh",
          "https://current.example.test/api/v1/execution-runner-tokens/refresh",
          "http://legacy.example.test/api/v1/execution-runners/disconnect",
        ],
      );
    }).pipe(Effect.scoped, Effect.provide(fixture.layer));
  },
);

it.effect.each(["file:///tmp/convene", "not an address"])(
  "rejects an invalid paired destination without contacting it (%s)",
  (baseUrl) => {
    const fixture = pairedSettingsFixture();
    return Effect.gen(function* () {
      const settings = yield* ConveneSettings.ConveneSettings;
      assert.equal(
        (yield* Effect.flip(settings.manage({ operation: "change-address", baseUrl }))).code,
        "INVALID_PLATFORM_URL",
      );
      assert.deepEqual(fixture.saved(), fixture.original);
      assert.equal(fixture.requests.length, 0);
      assert.equal(fixture.writes.length, 0);
    }).pipe(Effect.provide(fixture.layer));
  },
);

it.effect("keeps custom HTTP destinations available for an explicit address change", () => {
  const fixture = pairedSettingsFixture();
  return Effect.gen(function* () {
    const settings = yield* ConveneSettings.ConveneSettings;
    yield* settings.manage({ operation: "change-address", baseUrl: "http://custom.example.test" });
    assert.deepEqual(fixture.saved(), {
      ...fixture.original,
      baseUrl: "http://custom.example.test",
    });
    assert.equal(
      fixture.requests[0]?.url,
      "http://custom.example.test/api/v1/execution-runner-tokens/refresh",
    );
  }).pipe(Effect.provide(fixture.layer));
});

it.effect("loads the changed address and unchanged identity in a fresh platform service", () => {
  const fixture = pairedSettingsFixture();
  return Effect.gen(function* () {
    yield* Effect.gen(function* () {
      const settings = yield* ConveneSettings.ConveneSettings;
      yield* settings.manage({
        operation: "change-address",
        baseUrl: "https://current.example.test",
      });
    }).pipe(Effect.provide(fixture.layer));
    yield* Effect.gen(function* () {
      const platform = yield* ConvenePlatform.ConvenePlatform;
      assert.deepEqual(
        yield* platform.readConnection,
        Option.some({
          ...fixture.original,
          baseUrl: "https://current.example.test",
        }),
      );
      assert.equal(yield* platform.accessToken, "synthetic-access:current.example.test");
    }).pipe(Effect.provide(fixture.layer));
    assert.deepEqual(
      fixture.requests.map((request) => request.url),
      [
        "https://current.example.test/api/v1/execution-runner-tokens/refresh",
        "https://current.example.test/api/v1/execution-runner-tokens/refresh",
      ],
    );
  });
});

it.effect("does not start a new pairing when changing an unpaired connection", () => {
  const fixture = pairedSettingsFixture();
  return Effect.gen(function* () {
    const settings = yield* ConveneSettings.ConveneSettings;
    yield* settings.manage({ operation: "disconnect" });
    const requestCount = fixture.requests.length;
    assert.equal(
      (yield* Effect.flip(
        settings.manage({
          operation: "change-address",
          baseUrl: "https://current.example.test",
        }),
      )).code,
      "NOT_PAIRED",
    );
    assert.equal(fixture.saved(), undefined);
    assert.equal(fixture.requests.length, requestCount);
    assert.equal(fixture.writes.length, 0);
  }).pipe(Effect.provide(fixture.layer));
});

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
