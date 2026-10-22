import {
  ConveneIssueResource,
  ConveneResourceFailure,
  type ThreadId,
  type ConveneResourceReadInput,
  type ConveneResourceReadResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ConvenePlatform from "./ConvenePlatform.ts";
import * as ConveneConfiguration from "./ConveneConfiguration.ts";

export class ConveneResources extends Context.Service<
  ConveneResources,
  {
    readonly read: (
      input: typeof ConveneResourceReadInput.Type,
    ) => Effect.Effect<ConveneResourceReadResult>;
    readonly changes: (threadId: ThreadId) => Stream.Stream<number>;
  }
>()("t3/convene/ConveneResources") {}

const make = Effect.gen(function* () {
  const platform = yield* ConvenePlatform.ConvenePlatform;
  const configuration = yield* ConveneConfiguration.ConveneConfiguration;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const read = Effect.fn("ConveneResources.read")(function* (
    input: typeof ConveneResourceReadInput.Type,
  ) {
    const failure = (status: typeof ConveneResourceFailure.Type.status) => ({
      status,
      resource_uri: input.uri,
    });
    return yield* Effect.gen(function* () {
      const connection = yield* platform.readConnection;
      if (Option.isNone(connection)) return failure("disconnected");
      const thread = yield* projections.getThread(input.threadId);
      // The cache only routes the native project ID. The platform authorizes every read.
      const clientProjectId = yield* configuration.clientProjectId(thread.projectId);
      if (clientProjectId === null) return failure("projectUnavailable");
      const result = yield* platform.request(
        "execution-runner-resources/read",
        { client_project_id: clientProjectId, uri: input.uri, page: input.page },
        Schema.Union([ConveneIssueResource, ConveneResourceFailure]),
      );
      if (result.status !== "ready") return result;
      const baseUrl = connection.value.baseUrl.replace(/\/$/, "");
      return { ...result, web_url: `${baseUrl}${result.web_path}` };
    }).pipe(
      Effect.catchTags({
        ConvenePlatformError: (error) => {
          if (error.status === 401 || error.status === 403)
            return Effect.succeed(failure("unauthorized"));
          if (error.code === "RESOURCE_NOT_FOUND" || error.code === "ISSUE_NOT_FOUND")
            return Effect.succeed(failure("notFound"));
          if (error.code === "NOT_PAIRED") return Effect.succeed(failure("disconnected"));
          return Effect.succeed(failure("unavailable"));
        },
        ProjectionStoreThreadNotFoundError: () => Effect.succeed(failure("notFound")),
      }),
      Effect.catch(() => Effect.succeed(failure("unavailable"))),
    );
  });
  const changes = (threadId: ThreadId) =>
    Stream.fromEffect(projections.getThread(threadId)).pipe(
      Stream.flatMap((thread) =>
        configuration.changes.pipe(
          Stream.filter((projectId) => projectId === thread.projectId),
          Stream.scan(
            () => 0,
            (revision) => revision + 1,
          ),
        ),
      ),
      Stream.catch(() => Stream.empty),
    );
  return ConveneResources.of({ read, changes });
});

export const layer = Layer.effect(ConveneResources, make);
