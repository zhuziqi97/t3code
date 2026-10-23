import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as PubSub from "effect/PubSub";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";

export const Connection = Schema.Struct({
  baseUrl: Schema.String,
  runnerId: Schema.String,
  refreshCredential: Schema.String,
});
export type Connection = typeof Connection.Type;
const decodeConnection = Schema.decodeUnknownEffect(Schema.fromJsonString(Connection));
const encodeConnection = Schema.encodeEffect(Schema.fromJsonString(Connection));
const decodeErrorDetail = Schema.decodeUnknownOption(
  Schema.Struct({
    resource_type: Schema.optional(Schema.String),
    reason: Schema.optional(Schema.String),
  }),
);

export const Pairing = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  expires_in: Schema.Number,
  interval: Schema.Number,
});

export const Configuration = Schema.Struct({
  client_project_id: Schema.String,
  project: Schema.Struct({ native_project_id: Schema.String }),
  mcp_enabled: Schema.Boolean,
  targets: Schema.Array(
    Schema.Struct({
      target_id: Schema.String,
      native_workspace_key: Schema.String,
      path: Schema.NullOr(Schema.String),
      availability: Schema.Literals(["AVAILABLE", "UNAVAILABLE"]),
    }),
  ),
});
export type Configuration = typeof Configuration.Type;

const Credential = Schema.Struct({
  mcp_url: Schema.String,
  access_token: Schema.String,
  expires_at: Schema.String,
});
export type Credential = typeof Credential.Type;

export class ConvenePlatformError extends Schema.TaggedError<ConvenePlatformError>()(
  "ConvenePlatformError",
  {
    operation: Schema.String,
    status: Schema.optional(Schema.Number),
    code: Schema.optional(Schema.String),
    resourceType: Schema.optional(Schema.String),
    reason: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Convene ${this.operation} failed${this.code === undefined ? "" : ` (${this.code})`}.`;
  }
}

export class ConvenePlatform extends Context.Service<
  ConvenePlatform,
  {
    readonly readConnection: Effect.Effect<Option.Option<Connection>, ConvenePlatformError>;
    readonly beginPairing: (
      baseUrl: string,
    ) => Effect.Effect<typeof Pairing.Type, ConvenePlatformError>;
    readonly finishPairing: (
      baseUrl: string,
      deviceCode: string,
    ) => Effect.Effect<Connection, ConvenePlatformError>;
    readonly disconnect: Effect.Effect<void, ConvenePlatformError>;
    readonly accessToken: Effect.Effect<string, ConvenePlatformError>;
    readonly credential: (
      projectId: string,
      targetId: string,
    ) => Effect.Effect<Credential, ConvenePlatformError>;
    readonly changes: PubSub.PubSub<void>;
    readonly reconnect: Effect.Effect<void>;
    readonly request: <A, I>(
      path: string,
      body: Schema.Json,
      schema: Schema.Codec<A, I>,
    ) => Effect.Effect<A, ConvenePlatformError>;
  }
>()("t3/convene/ConvenePlatform") {}

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const http = yield* HttpClient.HttpClient;
  const changes = yield* PubSub.unbounded<void>();
  const reconnect = PubSub.publish(changes, undefined).pipe(Effect.asVoid);
  let access: { token: string; expiresAt: number; runnerId: string; baseUrl: string } | undefined;
  const readConnection = secrets.get("convene-connection.json").pipe(
    Effect.flatMap((bytes) =>
      Option.isNone(bytes)
        ? Effect.succeed(Option.none<Connection>())
        : decodeConnection(new TextDecoder().decode(bytes.value)).pipe(Effect.map(Option.some)),
    ),
    Effect.mapError((cause) => new ConvenePlatformError({ operation: "read-connection", cause })),
  );
  const post = Effect.fn("ConvenePlatform.post")(function* <A, I>(
    baseUrl: string,
    path: string,
    body: Schema.Json,
    schema: Schema.Codec<A, I>,
    token?: string,
  ) {
    let request = yield* HttpClientRequest.post(
      `${baseUrl.replace(/\/$/, "")}/api/v1/${path}`,
    ).pipe(
      HttpClientRequest.setHeader("Client-Protocol", "1.0"),
      HttpClientRequest.bodyJson(body),
      Effect.mapError((cause) => new ConvenePlatformError({ operation: path, cause })),
    );
    if (token !== undefined)
      request = HttpClientRequest.setHeader(request, "Authorization", `Bearer ${token}`);
    const response = yield* http
      .execute(request)
      .pipe(Effect.mapError((cause) => new ConvenePlatformError({ operation: path, cause })));
    if (response.status < 200 || response.status >= 300) {
      const error = yield* HttpClientResponse.schemaBodyJson(
        Schema.Struct({
          error: Schema.Struct({ code: Schema.String, detail: Schema.optional(Schema.Unknown) }),
        }),
      )(response).pipe(Effect.option);
      const detail = Option.isSome(error)
        ? decodeErrorDetail(error.value.error.detail)
        : Option.none();
      return yield* new ConvenePlatformError({
        operation: path,
        status: response.status,
        ...(Option.isSome(error) ? { code: error.value.error.code } : {}),
        ...(Option.isSome(detail) && detail.value.resource_type !== undefined
          ? { resourceType: detail.value.resource_type }
          : {}),
        ...(Option.isSome(detail) && detail.value.reason !== undefined
          ? { reason: detail.value.reason }
          : {}),
      });
    }
    const result = yield* HttpClientResponse.schemaBodyJson(
      Schema.Struct({ success: Schema.Literal(true), data: schema }),
    )(response).pipe(
      Effect.mapError((cause) => new ConvenePlatformError({ operation: path, cause })),
    );
    return result.data;
  });
  const connection = readConnection.pipe(
    Effect.flatMap((value) =>
      Option.isSome(value)
        ? Effect.succeed(value.value)
        : Effect.fail(new ConvenePlatformError({ operation: "connection", code: "NOT_PAIRED" })),
    ),
  );
  const tokenFor = Effect.fn("ConvenePlatform.tokenFor")(function* (current: Connection) {
    const now = yield* Clock.currentTimeMillis;
    if (
      access &&
      access.runnerId === current.runnerId &&
      access.baseUrl === current.baseUrl &&
      access.expiresAt > now + 30_000
    )
      return access.token;
    const result = yield* post(
      current.baseUrl,
      "execution-runner-tokens/refresh",
      { refresh_credential: current.refreshCredential },
      Schema.Struct({ access_token: Schema.String, expires_in: Schema.Number }),
    );
    access = {
      token: result.access_token,
      expiresAt: now + result.expires_in * 1_000,
      runnerId: current.runnerId,
      baseUrl: current.baseUrl,
    };
    return access.token;
  });
  const accessToken = connection.pipe(Effect.flatMap(tokenFor));
  return ConvenePlatform.of({
    readConnection,
    accessToken,
    changes,
    reconnect,
    request: Effect.fn("ConvenePlatform.request")(function* <A, I>(
      path: string,
      body: Schema.Json,
      schema: Schema.Codec<A, I>,
    ) {
      const current = yield* connection;
      return yield* post(current.baseUrl, path, body, schema, yield* tokenFor(current));
    }),
    beginPairing: (baseUrl) =>
      post(baseUrl, "execution-runner-pairings/create", { client_type: "t3" }, Pairing),
    finishPairing: Effect.fn("ConvenePlatform.finishPairing")(function* (baseUrl, deviceCode) {
      const result = yield* post(
        baseUrl,
        "execution-runner-pairings/exchange",
        { device_code: deviceCode },
        Schema.Struct({ runner_id: Schema.String, refresh_credential: Schema.String }),
      );
      const value = {
        baseUrl,
        runnerId: result.runner_id,
        refreshCredential: result.refresh_credential,
      };
      const encoded = yield* encodeConnection(value).pipe(
        Effect.mapError(
          (cause) => new ConvenePlatformError({ operation: "encode-connection", cause }),
        ),
      );
      yield* secrets
        .set("convene-connection.json", new TextEncoder().encode(encoded))
        .pipe(
          Effect.mapError(
            (cause) => new ConvenePlatformError({ operation: "persist-connection", cause }),
          ),
        );
      access = undefined;
      yield* reconnect;
      return value;
    }),
    disconnect: Effect.gen(function* () {
      const current = yield* readConnection;
      if (Option.isSome(current)) {
        yield* post(
          current.value.baseUrl,
          "execution-runners/disconnect",
          {},
          Schema.Unknown,
          yield* tokenFor(current.value),
        );
        yield* secrets.remove("convene-connection.json");
      }
      yield* reconnect;
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          access = undefined;
        }),
      ),
      Effect.mapError((cause) => new ConvenePlatformError({ operation: "disconnect", cause })),
    ),
    credential: Effect.fn("ConvenePlatform.credential")(function* (projectId, targetId) {
      const current = yield* connection;
      const token = yield* tokenFor(current);
      return yield* post(
        current.baseUrl,
        "execution-runner-configurations/credential",
        { client_project_id: projectId, target_id: targetId },
        Credential,
        token,
      );
    }),
  });
});

export const layer = Layer.effect(ConvenePlatform, make);
