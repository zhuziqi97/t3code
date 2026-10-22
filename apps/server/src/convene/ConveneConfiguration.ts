import {
  ConveneIntegrationError,
  ConveneProjectConfiguration,
  ConveneProjectOptions,
  type ConveneProjectMutation,
  type ConveneProjectOptionsInput,
  type ConveneProjectView,
  ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ConvenePlatform from "./ConvenePlatform.ts";
const encodeConfigurations = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Array(ConveneProjectConfiguration)),
);
const isPlatformError = Schema.is(ConvenePlatform.ConvenePlatformError);

export class ConveneConfiguration extends Context.Service<
  ConveneConfiguration,
  {
    readonly changes: Stream.Stream<ProjectId>;
    readonly record: (
      values: ReadonlyArray<ConveneProjectConfiguration>,
      replace: boolean,
    ) => Effect.Effect<void, ConveneIntegrationError>;
    readonly query: (
      projectId: ProjectId,
    ) => Effect.Effect<typeof ConveneProjectView.Type, ConveneIntegrationError>;
    readonly clientProjectId: (
      projectId: ProjectId,
    ) => Effect.Effect<string | null, ConveneIntegrationError>;
    readonly mutate: (
      input: ConveneProjectMutation,
    ) => Effect.Effect<ConveneProjectConfiguration, ConveneIntegrationError>;
    readonly options: (
      input: typeof ConveneProjectOptionsInput.Type,
    ) => Effect.Effect<typeof ConveneProjectOptions.Type, ConveneIntegrationError>;
  }
>()("t3/convene/ConveneConfiguration") {}

const make = Effect.gen(function* () {
  const platform = yield* ConvenePlatform.ConvenePlatform;
  const updates = yield* PubSub.unbounded<ProjectId>();
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const server = yield* ServerConfig.ServerConfig;
  const filename = path.join(server.stateDir, "convene-configurations.json");
  const decode = Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Array(ConveneProjectConfiguration)),
  );
  const initial = (yield* fs.exists(filename))
    ? yield* fs.readFileString(filename).pipe(Effect.flatMap(decode))
    : [];
  let cached = [...initial];
  let savedJson = yield* encodeConfigurations(cached);
  const lock = yield* Semaphore.make(1);
  const failure = (operation: string) =>
    Effect.mapError(
      (cause: unknown) =>
        new ConveneIntegrationError({
          operation,
          code: isPlatformError(cause) ? (cause.code ?? "PLATFORM_UNAVAILABLE") : "CONFIGURATION",
          cause,
        }),
    );
  const record = (values: ReadonlyArray<ConveneProjectConfiguration>, replace: boolean) =>
    lock
      .withPermit(
        Effect.gen(function* () {
          const next = new Map(
            (replace ? [] : cached).map((value) => [value.client_project_id, value]),
          );
          for (const value of values) next.set(value.client_project_id, value);
          const result = [...next.values()];
          const json = yield* encodeConfigurations(result);
          if (json !== savedJson) {
            yield* fs.writeFileString(filename, json);
            cached = result;
            savedJson = json;
          }
        }),
      )
      .pipe(
        Effect.tap(() =>
          Effect.forEach(
            values,
            (value) => PubSub.publish(updates, ProjectId.make(value.project.native_project_id)),
            { discard: true },
          ),
        ),
        failure("cache"),
      );
  const current = Effect.fn("ConveneConfiguration.current")(function* (projectId: ProjectId) {
    const connection = yield* platform.readConnection;
    if (Option.isNone(connection)) return null;
    return (
      cached.find(
        (value) =>
          value.runner_id === connection.value.runnerId &&
          value.project.native_project_id === projectId,
      ) ?? null
    );
  }, failure("query"));
  const query = Effect.fn("ConveneConfiguration.query")(function* (projectId: ProjectId) {
    const saved = yield* current(projectId);
    if (saved === null)
      return {
        configuration: null,
        fresh: false,
        error:
          "This project has no reported Convene configuration. Connect and refresh to report it.",
      };
    return yield* platform
      .request(
        "execution-runner-configurations/query",
        { client_project_id: saved.client_project_id },
        ConveneProjectConfiguration,
      )
      .pipe(
        Effect.tap((value) => record([value], false)),
        Effect.map((configuration) => ({ configuration, fresh: true, error: null })),
        Effect.catchTags({
          ConvenePlatformError: (error) =>
            Effect.succeed({ configuration: saved, fresh: false, error: error.message }),
        }),
      );
  });
  const mutate = Effect.fn("ConveneConfiguration.mutate")(function* (
    input: ConveneProjectMutation,
  ) {
    const saved = yield* current(input.projectId);
    if (!saved)
      return yield* new ConveneIntegrationError({
        operation: input.operation,
        code: "PROJECT_NOT_REPORTED",
      });
    let body: Schema.Json;
    if (input.operation === "save") {
      body = {
        client_project_id: saved.client_project_id,
        mcp_enabled: input.mcp_enabled,
        mcp_scope_modules: [...input.mcp_scope_modules],
        mcp_capabilities: { ...input.mcp_capabilities },
      };
    } else if (input.operation === "bind") {
      body = { client_project_id: saved.client_project_id, module_id: input.module_id };
    } else {
      if (
        !saved.bindings.some(
          (value) => value.binding_id === input.binding_id && value.status !== "REVOKED",
        )
      ) {
        return yield* new ConveneIntegrationError({
          operation: input.operation,
          code: "WRONG_PROJECT_BINDING",
        });
      }
      body = {
        binding_id: input.binding_id,
        ...("target_id" in input ? { target_id: input.target_id } : {}),
      };
    }
    const result =
      input.operation === "save"
        ? yield* platform
            .request(
              `execution-runner-configurations/${input.operation}`,
              body,
              ConveneProjectConfiguration,
            )
            .pipe(failure(input.operation))
        : (yield* platform
            .request(
              `execution-runner-configurations/${input.operation}`,
              body,
              Schema.Struct({ configuration: ConveneProjectConfiguration }),
            )
            .pipe(failure(input.operation))).configuration;
    yield* record([result], false);
    return result;
  });
  const options = Effect.fn("ConveneConfiguration.options")(function* (
    input: typeof ConveneProjectOptionsInput.Type,
  ) {
    if (input.projectId !== undefined) {
      return yield* platform
        .request(
          "execution-runner-configurations/modules/list",
          { project_id: input.projectId },
          ConveneProjectOptions,
        )
        .pipe(failure("modules"));
    }
    const result = yield* platform
      .request(
        "execution-runner-configurations/projects/list",
        { page: input.page, page_size: 20, search: input.search || null },
        Schema.Struct({ items: ConveneProjectOptions.fields.items, total: Schema.Number }),
      )
      .pipe(failure("projects"));
    return { ...result, truncated: false };
  });
  return ConveneConfiguration.of({
    record,
    query,
    mutate,
    options,
    changes: Stream.fromPubSub(updates),
    clientProjectId: Effect.fn("ConveneConfiguration.clientProjectId")(function* (projectId) {
      return (yield* current(projectId))?.client_project_id ?? null;
    }),
  });
});

export const layer = Layer.effect(ConveneConfiguration, make);
