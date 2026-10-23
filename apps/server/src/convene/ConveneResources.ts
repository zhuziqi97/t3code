import {
  ConveneIssueResource,
  ConveneResourceFailure,
  ConveneResourceSearchPage,
  type ConveneResourceSearchInput,
  type ConveneResourceSearchResult,
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
    readonly search: (
      input: typeof ConveneResourceSearchInput.Type,
    ) => Effect.Effect<ConveneResourceSearchResult>;
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
  const search = Effect.fn("ConveneResources.search")(function* (
    input: typeof ConveneResourceSearchInput.Type,
  ): Effect.fn.Return<ConveneResourceSearchResult> {
    return yield* Effect.gen(function* () {
      if (Option.isNone(yield* platform.readConnection)) return { status: "disconnected" as const };
      const clientProjectId = yield* configuration.clientProjectId(input.projectId);
      if (clientProjectId === null) return { status: "projectUnavailable" as const };
      const page = yield* platform.request(
        "execution-runner-resources/search",
        {
          client_project_id: clientProjectId,
          kind: input.kind,
          query: input.query,
          page: input.page,
          page_size: input.pageSize,
        },
        ConveneResourceSearchPage,
      );
      return { status: "ready" as const, ...page };
    }).pipe(
      Effect.catchTags({
        ConvenePlatformError: (error) => {
          if (error.code === "NOT_PAIRED")
            return Effect.succeed({ status: "disconnected" as const });
          if (error.status === 403 && error.reason === "MCP_DISABLED")
            return Effect.succeed({ status: "mcpDisabled" as const });
          if (error.status === 403 && error.reason === "CAPABILITY_DISABLED")
            return Effect.succeed({ status: "capabilityDisabled" as const });
          if (error.status === 403 && error.code === "MCP_SCOPE_INSUFFICIENT")
            return Effect.succeed({ status: "scopeInsufficient" as const });
          if (error.status === 401 || error.status === 403)
            return Effect.succeed({ status: "unauthorized" as const });
          if (error.status === 404 && error.resourceType === "client_project")
            return Effect.succeed({ status: "projectUnavailable" as const });
          return Effect.succeed({ status: "unavailable" as const });
        },
      }),
      Effect.catch(() => Effect.succeed({ status: "unavailable" as const })),
    );
  });
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
          // Missing API routes share the generic 404 code but have no business resource type.
          if (
            error.code === "MODULE_NOT_FOUND" ||
            error.code === "ISSUE_NOT_FOUND" ||
            (error.code === "RESOURCE_NOT_FOUND" &&
              (error.resourceType === "issue" || error.resourceType === "issue_comment"))
          )
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
  return ConveneResources.of({ read, changes, search });
});

export const layer = Layer.effect(ConveneResources, make);
