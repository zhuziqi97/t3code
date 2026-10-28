import * as Schema from "effect/Schema";
import { ClaudeSettings } from "@t3tools/contracts";
// @effect-diagnostics nodeBuiltinImport:off - the real CLI probe fixture observes its native filesystem output.
import * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import * as NodeFSP from "node:fs/promises";
import * as NodeServices from "@effect/platform-node/NodeServices";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { probeClaudeCapabilities, probeClaudeWorkspaceSnapshot } from "./ClaudeProvider.ts";
import { COMPACT_SLASH_COMMAND } from "@t3tools/provider-core/server/snapshotProbe";
// @effect-diagnostics nodeBuiltinImport:off - cleanup uses Node's retrying rm, which the FileSystem service does not expose.
import { vi } from "vite-plus/test";
import { assert, it } from "@effect/vitest";

import { buildClaudeCapabilitiesProbeQueryOptions } from "./ClaudeProvider.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", { spy: true });

const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);

it("drops strict MCP mode, and only that, next to an administrator's managed-mcp.json", () => {
  const options = buildClaudeCapabilitiesProbeQueryOptions({
    executablePath: "/usr/bin/claude",
    abortController: new AbortController(),
    environment: { HOME: "/home/user" },
    cwd: undefined,
    managedMcpConfig: true,
  });

  // Claude exits before initializing when handed --strict-mcp-config here.
  assert.equal(options.strictMcpConfig, undefined);
  assert.deepEqual(options.mcpServers, {});
  assert.equal(options.env?.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
});

it.layer(NodeServices.layer)("Claude capability probe SDK boundary", (it) => {
  it.effect(
    "discovers commands and skills separately for each cwd without replacing machine metadata",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-workspaces-" });
        const configDir = path.join(tempDir, "claude-home");
        const workspaces = [path.join(tempDir, "one"), path.join(tempDir, "two")];
        for (const cwd of workspaces) {
          const skillDir = path.join(cwd, ".claude", "skills", "existing-skill");
          yield* fs.makeDirectory(skillDir, { recursive: true });
          yield* fs.writeFileString(
            path.join(skillDir, "SKILL.md"),
            "---\nname: existing-skill\ndescription: Existing project skill\n---\nUse this skill.",
          );
        }
        const machineSnapshot = {
          instanceId: ProviderInstanceId.make("claude"),
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: true,
          installed: true,
          status: "ready",
          auth: { status: "authenticated", email: "machine@example.com" },
          checkedAt: "2026-03-25T00:00:00.000Z",
          version: "2.1.288",
          models: [],
          slashCommands: [{ name: "server-cwd-only" }],
          skills: [],
        } satisfies ServerProvider;
        let usageCalls = 0;
        const query = vi.spyOn(ClaudeSdk, "query").mockImplementation(({ options }) => {
          assert.equal(options?.env?.CLAUDE_CONFIG_DIR, configDir);
          assert.equal(options?.env?.T3_WORKSPACE_PROBE, "owned-instance");
          return {
            getContextUsage: async () => ({ model: "native-default" }),
            initializationResult: async () => ({
              account: { email: "workspace@example.com" },
              commands: [
                {
                  name: options?.cwd === workspaces[0] ? "start-session" : "other-project",
                  description: "Project command",
                  argumentHint: "[topic]",
                },
                { name: "nested:review", description: "Review changes", argumentHint: "" },
                { name: "NESTED:review", description: "", argumentHint: "[path]" },
                { name: "compact", description: "Provider compact", argumentHint: "" },
                { name: "user-command", description: "Existing user command", argumentHint: "" },
              ],
            }),
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
              usageCalls++;
              return { rate_limits_available: false, rate_limits: null };
            },
          } as ReturnType<typeof ClaudeSdk.query>;
        });
        yield* Effect.addFinalizer(() => Effect.sync(() => query.mockRestore()));
        for (const [index, cwd] of workspaces.entries()) {
          const scoped = yield* probeClaudeWorkspaceSnapshot(
            decodeClaudeSettings({ homePath: configDir }),
            machineSnapshot,
            cwd,
            { ...process.env, T3_WORKSPACE_PROBE: "owned-instance" },
          );
          assert.deepEqual(
            scoped.models.filter((model) => model.isDefault).map((model) => model.slug),
            ["native-default"],
          );
          assert.deepEqual(scoped, {
            ...machineSnapshot,
            models: scoped.models,
            slashCommandsPending: false,
            slashCommands: [
              COMPACT_SLASH_COMMAND,
              {
                name: index === 0 ? "start-session" : "other-project",
                description: "Project command",
                input: { hint: "[topic]" },
              },
              { name: "nested:review", description: "Review changes", input: { hint: "[path]" } },
              { name: "user-command", description: "Existing user command" },
            ],
            skills: [
              {
                name: "existing-skill",
                path: path.join(cwd, ".claude", "skills", "existing-skill", "SKILL.md"),
                enabled: true,
                scope: "project",
                description: "Existing project skill",
              },
            ],
          });
        }
        assert.deepEqual(
          query.mock.calls.map(([input]) => input.options?.cwd),
          workspaces,
        );
        assert.equal(usageCalls, 0);
      }).pipe(Effect.scoped),
  );

  it.effect("keeps readable skills during failed command discovery and recovers on retry", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-workspace-retry-" });
      const skillDir = path.join(cwd, ".claude", "skills", "existing-skill");
      yield* fs.makeDirectory(skillDir, { recursive: true });
      yield* fs.writeFileString(
        path.join(skillDir, "SKILL.md"),
        "---\nname: existing-skill\ndescription: Existing project skill\n---\nUse this skill.",
      );
      const machineSnapshot = {
        instanceId: ProviderInstanceId.make("claude"),
        driver: ProviderDriverKind.make("claudeAgent"),
        enabled: true,
        installed: true,
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-03-25T00:00:00.000Z",
        version: "2.1.288",
        models: [],
        slashCommands: [{ name: "server-cwd-only" }],
        skills: [],
      } satisfies ServerProvider;
      const query = vi.spyOn(ClaudeSdk, "query").mockImplementation(
        () =>
          ({
            getContextUsage: async () => ({ model: "native-default" }),
            initializationResult: () =>
              Promise.reject<ClaudeSdk.SDKControlInitializeResponse>(
                new Error("Initialization failed"),
              ),
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
              rate_limits_available: false,
              rate_limits: null,
            }),
          }) as ReturnType<typeof ClaudeSdk.query>,
      );
      yield* Effect.addFinalizer(() => Effect.sync(() => query.mockRestore()));
      const settings = decodeClaudeSettings({ homePath: cwd });
      const failed = yield* probeClaudeWorkspaceSnapshot(settings, machineSnapshot, cwd);
      assert.deepEqual(failed, {
        ...machineSnapshot,
        slashCommands: [COMPACT_SLASH_COMMAND],
        slashCommandsPending: true,
        skills: [
          {
            name: "existing-skill",
            path: path.join(skillDir, "SKILL.md"),
            enabled: true,
            scope: "project",
            description: "Existing project skill",
          },
        ],
      });
      query.mockImplementation(
        () =>
          ({
            getContextUsage: async () => ({ model: "native-default" }),
            initializationResult: async () => ({
              commands: [{ name: "recovered", description: "", argumentHint: "" }],
            }),
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
              rate_limits_available: false,
              rate_limits: null,
            }),
          }) as ReturnType<typeof ClaudeSdk.query>,
      );
      const recovered = yield* probeClaudeWorkspaceSnapshot(settings, machineSnapshot, cwd);
      assert.deepEqual(recovered.slashCommands, [COMPACT_SLASH_COMMAND, { name: "recovered" }]);
      assert.equal(recovered.status, "ready");
      assert.equal(recovered.slashCommandsPending, false);
      assert.deepEqual(recovered.skills, failed.skills);
      const disabled = yield* probeClaudeWorkspaceSnapshot(
        { ...settings, enabled: false },
        machineSnapshot,
        cwd,
      );
      assert.equal(disabled, machineSnapshot);
      assert.equal(query.mock.calls.length, 2);
    }).pipe(Effect.scoped),
  );

  it.effect("serializes strict no-MCP options and still resolves account capabilities", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-probe-sdk-" });
      const executablePath = yield* path.fromFileUrl(
        new URL("./testing/ClaudeCapabilitiesProbe.fixture.mjs", import.meta.url),
      );
      const invocationPath = path.join(tempDir, "invocation.json");
      // The probe aborts the SDK without awaiting the child's exit, and on
      // Windows a directory that is still some process's cwd cannot be
      // removed. Keep the workspace outside the scoped directory and let it
      // go with a retrying removal once the child has gone.
      const workspaceCwd = yield* fs.makeTempDirectory({ prefix: "t3-claude-probe-cwd-" });
      // Node's own retry rather than an Effect schedule: it.effect runs on a
      // TestClock, so a scheduled retry would wait for time nobody advances.
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          NodeFSP.rm(workspaceCwd, {
            recursive: true,
            force: true,
            maxRetries: 20,
            retryDelay: 250,
          }).catch(() => undefined),
        ),
      );

      const capabilities = yield* probeClaudeCapabilities(
        decodeClaudeSettings({ binaryPath: executablePath }),
        {
          ...process.env,
          T3_PROBE_INVOCATION_PATH: invocationPath,
          ENABLE_CLAUDEAI_MCP_SERVERS: "true",
        },
        workspaceCwd,
      );

      assert.deepEqual(capabilities, {
        email: "dev@example.com",
        subscriptionType: "pro",
        tokenSource: "oauth",
        apiKeySource: undefined,
        apiProvider: undefined,
        models: [],
        defaultModel: "fixture-native-default",
        slashCommands: [
          {
            name: "review",
            description: "Review changes",
            input: { hint: "[path]" },
          },
        ],
        usage: {
          rate_limits_available: true,
          rate_limits: { five_hour: { utilization: 12, resets_at: "2026-07-18T14:39:00Z" } },
        },
        usageCheckedAt: "1970-01-01T00:00:00.000Z",
      });

      const invocation = JSON.parse(yield* fs.readFileString(invocationPath)) as {
        readonly args: ReadonlyArray<string>;
        readonly cwd: string;
        readonly connectorEnv: string;
        readonly mcpConfig: unknown;
      };
      assert.equal(invocation.cwd, yield* fs.realPath(workspaceCwd));
      assert.equal(invocation.connectorEnv, "false");
      assert.equal(invocation.args.includes("--strict-mcp-config"), true);
      assert.equal(invocation.args.includes("--mcp-config"), false);
      assert.equal(invocation.mcpConfig, undefined);

      assert.equal(invocation.args.includes("--setting-sources=user,project,local"), true);

      const settingsFlagIndex = invocation.args.indexOf("--settings");
      assert.notEqual(settingsFlagIndex, -1);
      const flagSettings = JSON.parse(invocation.args[settingsFlagIndex + 1] ?? "{}") as {
        readonly disableAllHooks?: boolean;
      };
      assert.equal(flagSettings.disableAllHooks, true);
    }).pipe(Effect.scoped),
  );
});

it.effect("preserves initialized capabilities when optional usage times out", () =>
  Effect.gen(function* () {
    const usageStarted = yield* Deferred.make<void>();
    let abortSignal: AbortSignal | undefined;
    const query = vi.spyOn(ClaudeSdk, "query").mockImplementation(({ options }) => {
      abortSignal = options?.abortController?.signal;
      return {
        getContextUsage: async () => ({ model: "native-default" }),
        initializationResult: async () => ({
          account: { email: "dev@example.com", subscriptionType: "pro", tokenSource: "oauth" },
          commands: [{ name: "review", description: "Review changes", argumentHint: "[path]" }],
        }),
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () => {
          Deferred.doneUnsafe(usageStarted, Effect.void);
          return new Promise(() => {});
        },
      } as ReturnType<typeof ClaudeSdk.query>;
    });
    yield* Effect.addFinalizer(() => Effect.sync(() => query.mockRestore()));
    const probe = yield* probeClaudeCapabilities(
      decodeClaudeSettings({ binaryPath: "claude" }),
    ).pipe(Effect.forkChild);
    yield* Deferred.await(usageStarted);
    yield* TestClock.adjust("4 seconds");
    const capabilities = yield* Fiber.join(probe);
    assert.equal(capabilities?.email, "dev@example.com");
    assert.equal(capabilities?.subscriptionType, "pro");
    assert.equal(capabilities?.tokenSource, "oauth");
    assert.deepEqual(capabilities?.slashCommands, [
      { name: "review", description: "Review changes", input: { hint: "[path]" } },
    ]);
    assert.equal(capabilities?.usage, undefined);
    assert.equal(capabilities?.defaultModel, "native-default");
    assert.equal(abortSignal?.aborted, true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("keeps hung initialization owned until explicit cancellation", () =>
  Effect.gen(function* () {
    let signal: AbortSignal | undefined;
    const initializationStarted = yield* Deferred.make<void>();
    const query = vi.spyOn(ClaudeSdk, "query").mockImplementation((input) => {
      signal = input.options?.abortController?.signal;
      return {
        initializationResult: () => {
          Deferred.doneUnsafe(initializationStarted, Effect.void);
          return new Promise(() => {});
        },
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
          rate_limits_available: true,
          rate_limits: {},
        }),
      } as ReturnType<typeof ClaudeSdk.query>;
    });
    yield* Effect.addFinalizer(() => Effect.sync(() => query.mockRestore()));
    const probe = yield* probeClaudeCapabilities(
      decodeClaudeSettings({ binaryPath: "claude" }),
    ).pipe(Effect.result, Effect.forkChild);

    yield* Deferred.await(initializationStarted);
    yield* Fiber.interrupt(probe);
    assert.isTrue(signal?.aborted);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("asks for usage without the local transcript scan", () =>
  Effect.gen(function* () {
    let usageOptions: unknown;
    const query = vi.spyOn(ClaudeSdk, "query").mockImplementation(
      () =>
        ({
          getContextUsage: async () => ({ model: "native-default" }),
          initializationResult: async () => ({
            account: { email: "dev@example.com", subscriptionType: "max", tokenSource: "oauth" },
            commands: [],
          }),
          usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async (options?: unknown) => {
            usageOptions = options;
            return { rate_limits_available: true, rate_limits: null };
          },
        }) as unknown as ReturnType<typeof ClaudeSdk.query>,
    );
    yield* Effect.addFinalizer(() => Effect.sync(() => query.mockRestore()));
    yield* probeClaudeCapabilities(decodeClaudeSettings({ binaryPath: "claude" }));
    assert.deepEqual(usageOptions, { skipBehaviors: true });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("accepts a late SDK initialization without the former overall deadline", () =>
  Effect.gen(function* () {
    const entered = Promise.withResolvers<void>();
    const initialized = Promise.withResolvers<{ commands: never[] }>();
    let abortSignal: AbortSignal | undefined;
    const query = vi.spyOn(ClaudeSdk, "query").mockImplementation(({ options }) => {
      abortSignal = options?.abortController?.signal;
      return {
        initializationResult: () => {
          entered.resolve();
          return initialized.promise;
        },
        getContextUsage: async () => ({ model: "native-default" }),
      } as unknown as ReturnType<typeof ClaudeSdk.query>;
    });
    yield* Effect.addFinalizer(() => Effect.sync(() => query.mockRestore()));
    const running = yield* probeClaudeCapabilities(
      decodeClaudeSettings({ binaryPath: "claude" }),
      {},
      "/tmp",
      false,
    ).pipe(Effect.forkChild);
    yield* Effect.promise(() => entered.promise);
    yield* TestClock.adjust("61 seconds");
    assert.isUndefined(yield* Effect.sync(() => running.pollUnsafe()));
    assert.equal(abortSignal?.aborted, false);
    initialized.resolve({ commands: [] });
    const capabilities = yield* Fiber.join(running);
    assert.equal(capabilities?.defaultModel, "native-default");
    assert.equal(abortSignal?.aborted, true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("owns the native gateway discovery grace and closes its process before completion", () =>
  Effect.gen(function* () {
    const contextRead = Promise.withResolvers<void>();
    let abortSignal: AbortSignal | undefined;
    const query = vi.spyOn(ClaudeSdk, "query").mockImplementation(({ options }) => {
      abortSignal = options?.abortController?.signal;
      return {
        getContextUsage: async () => {
          contextRead.resolve();
          return { model: "native-default" };
        },
        initializationResult: async () => ({
          commands: [],
          models: [
            {
              value: "claude-gateway-native",
              displayName: "Gateway Native",
              description: "",
              supportsEffort: true,
              supportedEffortLevels: ["high", "max"],
            },
          ],
        }),
      } as unknown as ReturnType<typeof ClaudeSdk.query>;
    });
    yield* Effect.addFinalizer(() => Effect.sync(() => query.mockRestore()));
    const running = yield* probeClaudeCapabilities(
      decodeClaudeSettings({ binaryPath: "claude" }),
      {
        ANTHROPIC_BASE_URL: "http://127.0.0.1:12345",
        CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
        CLAUDE_CODE_GATEWAY_MODEL_DISCOVERY_TIMEOUT_MS: "3000",
      },
      "/tmp",
      false,
    ).pipe(Effect.forkChild);
    yield* Effect.promise(() => contextRead.promise);
    assert.equal(abortSignal?.aborted, false);
    yield* TestClock.adjust("3 seconds");
    const capabilities = yield* Fiber.join(running);
    assert.equal(capabilities?.models?.[0]?.displayName, "Gateway Native");
    assert.equal(abortSignal?.aborted, true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("reports a deleted worktree's scan as finished, not pending", () =>
  Effect.gen(function* () {
    const snapshot = yield* probeClaudeWorkspaceSnapshot(
      decodeClaudeSettings({}),
      { skills: [], slashCommands: [] } as unknown as ServerProvider,
      "/nonexistent/t3-deleted-worktree",
      { HOME: "/nonexistent/t3-home" },
    );
    assert.strictEqual(snapshot.slashCommandsPending, false);
  }).pipe(Effect.provide(NodeServices.layer)),
);
