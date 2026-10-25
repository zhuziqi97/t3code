import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, type ConveneProjectConfiguration } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Queue from "effect/Queue";
import * as ServerConfig from "../config.ts";
import * as ConveneConfiguration from "./ConveneConfiguration.ts";
import * as ConvenePlatform from "./ConvenePlatform.ts";
import * as ConveneConnection from "./ConveneConnection.ts";
import * as ConveneSettings from "./ConveneSettings.ts";

const projectId = ProjectId.make("native-project");
const configuration: ConveneProjectConfiguration = {
  runner_id: "runner-a",
  runner_name: "Laptop",
  client_project_id: "client-project-a",
  project: { native_project_id: projectId, display_name: "Local project" },
  targets: [
    {
      target_id: "target-a",
      native_workspace_key: "root",
      path: "/tmp/project",
      workspace_display_name: "Root",
      branch: null,
      availability: "AVAILABLE",
    },
  ],
  bindings: [
    {
      binding_id: "binding-a",
      module_id: "execution-module",
      runner_id: "runner-a",
      client_project_id: "client-project-a",
      target_id: null,
      status: "DISABLED",
    },
  ],
  mcp_enabled: false,
  mcp_scope_modules: [],
  mcp_capabilities: { code_graph_enabled: false, forge_enabled: false, issue_enabled: false },
  mcp_scope_details: [],
  binding_module_details: [],
};

it.effect(
  "refreshes the cache without echoing queries as changes, while identical control updates still notify",
  () =>
    Effect.gen(function* () {
      let reply = configuration;
      const changes = yield* PubSub.unbounded<void>();
      const context = yield* Layer.build(
        ConveneConfiguration.layer.pipe(
          Layer.provide(
            Layer.mock(ConvenePlatform.ConvenePlatform, {
              changes,
              readConnection: Effect.succeed(
                Option.some({
                  baseUrl: "http://localhost",
                  runnerId: "runner-a",
                  refreshCredential: "fixture",
                }),
              ),
              request: (_path, _body, schema) =>
                Schema.decodeUnknownEffect(schema)(reply).pipe(
                  Effect.mapError(
                    (cause) =>
                      new ConvenePlatform.ConvenePlatformError({ operation: "query", cause }),
                  ),
                ),
            }),
          ),
          Layer.provide(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-convene-query-events-" }),
          ),
          Layer.provide(NodeServices.layer),
        ),
      );
      const service = Context.get(context, ConveneConfiguration.ConveneConfiguration);
      yield* service.record([configuration], true);
      const events = yield* Queue.unbounded<ProjectId>();
      yield* service.changes.pipe(
        Stream.runForEach((id) => Queue.offer(events, id)),
        Effect.forkChild({ startImmediately: true }),
      );
      reply = { ...configuration, project: { ...configuration.project, display_name: "Renamed" } };
      assert.equal(
        (yield* service.query(projectId)).configuration?.project.display_name,
        "Renamed",
      );
      const otherProjectId = ProjectId.make("other-project");
      yield* service.record(
        [
          {
            ...configuration,
            client_project_id: "other-client-project",
            project: { ...configuration.project, native_project_id: otherProjectId },
          },
        ],
        false,
      );
      assert.equal(yield* Queue.take(events), otherProjectId);
      yield* service.record([reply], false);
      assert.equal(yield* Queue.take(events), projectId);
      yield* service.record([reply], false);
      assert.equal(yield* Queue.take(events), projectId);
    }).pipe(Effect.scoped),
);

it.effect(
  "reports targets only to discover an unreported project, not on every project query",
  () => {
    let reported = true;
    let reports = 0;
    let queries = 0;
    return Effect.gen(function* () {
      const changes = yield* PubSub.unbounded<void>();
      return yield* Effect.gen(function* () {
        const settings = yield* ConveneSettings.ConveneSettings;
        assert.equal((yield* settings.queryProject(projectId)).configuration, configuration);
        assert.equal(reports, 0);
        assert.equal(queries, 1);
        reported = false;
        assert.equal((yield* settings.queryProject(projectId)).configuration, configuration);
        assert.equal(reports, 1);
        assert.equal(queries, 3);
      }).pipe(
        Effect.provide(
          ConveneSettings.layer.pipe(
            Layer.provide(Layer.mock(ConvenePlatform.ConvenePlatform, { changes })),
            Layer.provide(
              Layer.mock(ConveneConnection.ConveneConnection, {
                status: Effect.succeed({
                  phase: "online" as const,
                  platformUrls: [],
                  baseUrl: "http://localhost",
                  runnerId: "runner-a",
                  error: null,
                }),
                synchronize: Effect.sync(() => {
                  reports++;
                  reported = true;
                }),
              }),
            ),
            Layer.provide(
              Layer.mock(ConveneConfiguration.ConveneConfiguration, {
                query: () =>
                  Effect.sync(() => {
                    queries++;
                    return {
                      configuration: reported ? configuration : null,
                      fresh: reported,
                      error: null,
                    };
                  }),
              }),
            ),
          ),
        ),
      );
    }).pipe(Effect.scoped);
  },
);

it.effect(
  "keeps MCP scope independent of execution operations and retains the last configuration when the platform is offline",
  () =>
    Effect.gen(function* () {
      const calls: Array<{ path: string; body: Schema.Json }> = [];
      let offline = false;
      let runner = "runner-a";
      const changes = yield* PubSub.unbounded<void>();
      const platform = Layer.mock(ConvenePlatform.ConvenePlatform, {
        changes,
        readConnection: Effect.sync(() =>
          Option.some({
            baseUrl: "http://localhost",
            runnerId: runner,
            refreshCredential: "private-device-secret",
          }),
        ),
        request: (path, body, schema) =>
          Effect.gen(function* () {
            if (offline)
              return yield* new ConvenePlatform.ConvenePlatformError({
                operation: path,
                code: "OFFLINE",
              });
            calls.push({ path, body });
            const result = path.endsWith("/bind") ? { configuration } : configuration;
            return yield* Schema.decodeUnknownEffect(schema)(result).pipe(
              Effect.mapError(
                (cause) => new ConvenePlatform.ConvenePlatformError({ operation: path, cause }),
              ),
            );
          }),
      });
      const context = yield* Layer.build(
        ConveneConfiguration.layer.pipe(
          Layer.provide(platform),
          Layer.provide(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-convene-configuration-" }),
          ),
          Layer.provide(NodeServices.layer),
        ),
      );
      const service = Context.get(context, ConveneConfiguration.ConveneConfiguration);
      assert.equal((yield* service.query(projectId)).configuration, null);
      assert.equal(calls.length, 0);
      yield* service.record([configuration], true);
      yield* service.mutate({
        operation: "bind",
        projectId,
        module_id: "another-execution-module",
      });
      assert.deepEqual(calls[0], {
        path: "execution-runner-configurations/bind",
        body: { client_project_id: "client-project-a", module_id: "another-execution-module" },
      });
      const scope = [{ module_id: "unrelated-platform-module", permission: "WRITE" as const }];
      yield* service.mutate({
        operation: "save",
        projectId,
        mcp_enabled: true,
        mcp_scope_modules: scope,
        mcp_capabilities: { forge_enabled: true, code_graph_enabled: false, issue_enabled: true },
      });
      assert.deepEqual(calls[1]?.body, {
        client_project_id: "client-project-a",
        mcp_enabled: true,
        mcp_scope_modules: scope,
        mcp_capabilities: { forge_enabled: true, code_graph_enabled: false, issue_enabled: true },
      });
      const wrongBinding = yield* service
        .mutate({
          operation: "activate",
          projectId,
          binding_id: "other-project-binding",
          target_id: "target-a",
        })
        .pipe(Effect.flip);
      assert.equal(wrongBinding.code, "WRONG_PROJECT_BINDING");
      assert.equal(calls.length, 2);
      offline = true;
      const cached = yield* service.query(projectId);
      assert.equal(cached.fresh, false);
      assert.deepEqual(cached.configuration, configuration);
      assert.isNotNull(cached.error);
      runner = "runner-b";
      assert.equal((yield* service.query(projectId)).configuration, null);
    }).pipe(Effect.scoped),
);
