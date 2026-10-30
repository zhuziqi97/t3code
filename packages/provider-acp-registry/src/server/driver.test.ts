import { AcpRegistryOperationError, ProviderInstanceId } from "@t3tools/contracts";
import { AcpRegistrySettings } from "../settings.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as AcpRegistrySupport from "./AcpRegistrySupport.ts";
import {
  applyAcpRegistryAvailableCommands,
  buildCheckedAcpRegistrySnapshot,
  checkAcpRegistryProviderReadiness,
  checkAcpRegistryProviderStatus,
} from "./driver.ts";

const decodeSettings = Schema.decodeSync(AcpRegistrySettings);
it("reads legacy ACP model strings and preserves named capability overrides", () => {
  const customModels = [
    "native-old-id",
    {
      slug: "native-new-id",
      name: "Native display",
      capabilities: {
        optionDescriptors: [
          {
            id: "effort",
            label: "Effort",
            type: "select" as const,
            options: [{ id: "high", label: "High" }],
          },
        ],
      },
    },
  ];
  expect(decodeSettings({ customModels }).customModels).toEqual(customModels);
});

const identity = {
  instanceId: ProviderInstanceId.make("acpRegistry_test"),
  displayName: "Test ACP",
  accentColor: undefined,
  continuationKey: "acpRegistry:instance:acpRegistry_test",
};
const noSessionManagement = {
  canList: false,
  canLoad: false,
  canResume: false,
  canLogout: false,
  canDelete: false,
  canConfigureProviders: false,
} as const;

function catalogWithInspection(
  inspection: AcpRegistrySupport.AcpRegistryInspection,
): AcpRegistrySupport.AcpRegistryCatalog["Service"] {
  return {
    refresh: () => Effect.die("unused refresh"),
    search: () => Effect.die("unused search"),
    prepare: () => Effect.die("unused prepare"),
    inspect: () => Effect.succeed(inspection),
    resolve: () => Effect.die("unused resolve"),
    uninstallManagedBinary: () => Effect.die("unused uninstall"),
  };
}

describe("acpRegistrySnapshotReadiness", () => {
  it("compares the installed version with the directory and retains the last successful check", () => {
    const snapshot = buildCheckedAcpRegistrySnapshot({
      ...identity,
      settings: decodeSettings({ agentId: "test-agent" }),
      checkedAt: "2026-10-28T11:00:00.000Z",
      inspection: {
        status: "ready",
        agentId: "test-agent",
        distribution: "binary",
        version: "1.0.0",
        latestVersion: "2.0.0",
        registryCheck: { lastSuccessAt: "2026-10-28T10:00:00.000Z", error: "Registry is offline." },
      },
    });
    expect(snapshot.version).toBe("1.0.0");
    expect(snapshot.versionAdvisory).toMatchObject({
      status: "behind_latest",
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      checkedAt: "2026-10-28T10:00:00.000Z",
      canUpdate: false,
    });
    expect(snapshot.versionAdvisory?.message).toContain("Registry is offline.");
  });

  it.each([null, "3.0.0"])("does not advertise an upgrade for installed version %s", (version) => {
    const snapshot = buildCheckedAcpRegistrySnapshot({
      ...identity,
      settings: decodeSettings({ agentId: "test-agent", commandPath: "/custom/agent" }),
      checkedAt: "2026-10-28T11:00:00.000Z",
      inspection: {
        status: "ready",
        agentId: "test-agent",
        version,
        latestVersion: "2.0.0",
        distribution: "binary",
      },
    });
    expect(snapshot.versionAdvisory?.status).toBe(version === null ? "unknown" : "current");
    expect(snapshot.versionAdvisory?.canUpdate).toBe(false);
  });

  it("suppresses update advisories when provider update checks are disabled", () => {
    const snapshot = buildCheckedAcpRegistrySnapshot({
      ...identity,
      settings: decodeSettings({ agentId: "test-agent" }),
      checkedAt: "2026-10-28T11:00:00.000Z",
      enableProviderUpdateChecks: false,
      inspection: {
        status: "ready",
        agentId: "test-agent",
        version: "1.0.0",
        latestVersion: "2.0.0",
        distribution: "binary",
      },
    });
    expect(snapshot.versionAdvisory).toMatchObject({ status: "unknown", latestVersion: null });
  });

  it("treats a live empty command advertisement as an authoritative replacement", () => {
    const provider = buildCheckedAcpRegistrySnapshot({
      ...identity,
      settings: decodeSettings({ agentId: "test-agent" }),
      checkedAt: "2026-08-13T10:00:00.000Z",
      inspection: {
        status: "ready",
        agentId: "test-agent",
        version: "1.0.0",
        distribution: "npx",
        documentationUrl: "https://example.test/agent/setup",
      },
      probe: {
        probe: {
          instanceId: identity.instanceId,
          ready: true,
          icon: null,
          authMethods: [],
          models: [],
          currentModelId: null,
          configOptions: [],
          sessionManagement: noSessionManagement,
        },
        slashCommands: [{ name: "stale" }],
        skills: [{ name: "stale-skill", path: "stale", enabled: true }],
      },
    });

    const replaced = applyAcpRegistryAvailableCommands(
      provider,
      Option.some({ slashCommands: [], skills: [] }),
    );
    expect(replaced.slashCommands).toEqual([]);
    expect(replaced.skills).toEqual([]);
    expect(applyAcpRegistryAvailableCommands(provider, Option.none()).slashCommands).toEqual([
      { name: "stale" },
    ]);
    expect(provider.iconUrl).toBe(
      "https://cdn.agentclientprotocol.com/registry/v1/latest/test-agent.svg",
    );
    expect(provider.setup).toMatchObject({
      canAuthenticate: false,
      documentationUrl: "https://example.test/agent/setup",
    });
  });

  it("keeps authentication unknown when an agent permits a discovery session before sign-in", () => {
    const snapshot = buildCheckedAcpRegistrySnapshot({
      ...identity,
      settings: decodeSettings({ agentId: "test-agent" }),
      checkedAt: "2026-08-13T10:00:00.000Z",
      inspection: {
        status: "ready",
        agentId: "test-agent",
        version: "1.0.0",
        distribution: "binary",
      },
      probe: {
        probe: {
          instanceId: identity.instanceId,
          ready: true,
          icon: null,
          authMethods: [{ id: "browser", name: "Browser", description: null, type: "agent" }],
          models: [],
          currentModelId: null,
          configOptions: [],
          sessionManagement: noSessionManagement,
        },
        slashCommands: [],
        skills: [],
      },
    });
    expect(snapshot.auth.status).toBe("unknown");
    expect(snapshot.setup?.canAuthenticate).toBe(true);
  });

  it("projects discovery without claiming authentication when no login methods are advertised", () => {
    const snapshot = buildCheckedAcpRegistrySnapshot({
      ...identity,
      settings: decodeSettings({
        agentId: "test-agent",
        customModels: [" custom-model ", "gpt-discovered"],
      }),
      checkedAt: "2026-08-13T10:00:00.000Z",
      inspection: {
        status: "ready",
        agentId: "test-agent",
        version: "1.0.0",
        distribution: "npx",
      },
      probe: {
        probe: {
          instanceId: identity.instanceId,
          ready: true,
          icon: null,
          authMethods: [],
          models: [{ id: "gpt-discovered", name: "GPT Discovered", description: null }],
          currentModelId: "gpt-discovered",
          configOptions: [],
          sessionManagement: noSessionManagement,
        },
        slashCommands: [{ name: "plan", description: "Create a plan", input: { hint: "topic" } }],
        skills: [{ name: "workspace-skill", path: "acp://skill/workspace-skill", enabled: true }],
      },
    });

    expect(snapshot.auth).toEqual({ status: "unknown", canLogout: false });
    expect(snapshot.supportsTextGeneration).toBe(false);
    expect(
      snapshot.models.map(({ slug, name, isCustom, isDefault }) => ({
        slug,
        name,
        isCustom,
        isDefault,
      })),
    ).toEqual([
      {
        slug: "gpt-discovered",
        name: "GPT Discovered",
        isCustom: false,
        isDefault: true,
      },
      {
        slug: "custom-model",
        name: "custom-model",
        isCustom: true,
        isDefault: undefined,
      },
    ]);
    expect(snapshot.slashCommands).toEqual([
      { name: "plan", description: "Create a plan", input: { hint: "topic" } },
    ]);
    expect(snapshot.skills).toEqual([
      { name: "workspace-skill", path: "acp://skill/workspace-skill", enabled: true },
    ]);
  });

  it("keeps an empty-catalog fallback without claiming a reported default model", () => {
    const snapshot = buildCheckedAcpRegistrySnapshot({
      ...identity,
      settings: decodeSettings({ agentId: "test-agent" }),
      checkedAt: "2026-08-13T10:00:00.000Z",
      inspection: {
        status: "ready",
        agentId: "test-agent",
        version: "1.0.0",
        distribution: "uvx",
      },
      probe: {
        probe: {
          instanceId: identity.instanceId,
          ready: true,
          icon: null,
          authMethods: [],
          models: [],
          currentModelId: null,
          configOptions: [],
          sessionManagement: noSessionManagement,
        },
        slashCommands: [],
        skills: [],
      },
    });

    expect(snapshot.models.map((model) => model.slug)).toEqual(["default"]);
    expect(snapshot.models[0]?.isDefault).toBeUndefined();
  });

  it.each(["registry", "local"] as const)(
    "reports failed authentication after successful %s inspection",
    (source) => {
      const snapshot = buildCheckedAcpRegistrySnapshot({
        ...identity,
        settings: decodeSettings({
          source,
          ...(source === "local" ? { commandPath: "test-agent" } : { agentId: "test-agent" }),
          authMethodId: "grok-login",
        }),
        checkedAt: "2026-08-13T10:00:00.000Z",
        inspection: {
          status: "ready",
          agentId: "test-agent",
          version: source === "local" ? null : "1.0.0",
          distribution: source === "local" ? "local" : "binary",
        },
        probeError: new AcpRegistryOperationError({
          reason: "authentication_failed",
          message: "Login required.",
          authMethods: [
            {
              id: "api-key",
              name: "API key",
              description: null,
              type: "env_var",
            },
            {
              id: "grok-login",
              name: "Log in with Grok",
              description: null,
              type: "agent",
            },
          ],
        }),
      });

      expect(snapshot).toMatchObject({
        installed: true,
        version: source === "local" ? null : "1.0.0",
        status: "warning",
        setup: { canAuthenticate: true },
        auth: {
          status: "unauthenticated",
          type: "agent",
          label: "Log in with Grok",
        },
        message: 'Sign in in provider settings using "Log in with Grok".',
      });
    },
  );

  it.effect("runs the disposable probe only after local inspection is ready", () =>
    Effect.gen(function* () {
      const settings = decodeSettings({ agentId: "test-agent" });
      const environment = { PATH: "/provider/bin" };
      let receivedEnvironment: NodeJS.ProcessEnv | undefined;
      const snapshot = yield* checkAcpRegistryProviderStatus(
        {
          ...identity,
          settings,
          cwd: "/workspace",
          environment,
        },
        (input) =>
          Effect.sync(() => {
            receivedEnvironment = input.environment;
            return {
              probe: {
                instanceId: identity.instanceId,
                ready: true as const,
                icon: null,
                authMethods: [],
                models: [{ id: "agent-model", name: "Agent Model", description: null }],
                currentModelId: "agent-model",
                configOptions: [],
                sessionManagement: noSessionManagement,
              },
              slashCommands: [{ name: "review" }],
              skills: [],
            };
          }),
      ).pipe(
        Effect.provideService(
          AcpRegistrySupport.AcpRegistryCatalog,
          catalogWithInspection({
            status: "ready",
            agentId: "test-agent",
            version: "1.0.0",
            distribution: "npx",
          }),
        ),
      );

      expect(receivedEnvironment).toBe(environment);
      expect(snapshot).toMatchObject({
        auth: { status: "unknown" },
        models: [{ slug: "agent-model" }],
        slashCommands: [{ name: "review" }],
        skills: [],
      });
    }),
  );

  it.effect("publishes concrete local readiness before background ACP discovery", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkAcpRegistryProviderReadiness({
        ...identity,
        settings: decodeSettings({ agentId: "test-agent" }),
        environment: { PATH: "/provider/bin" },
      }).pipe(
        Effect.provideService(
          AcpRegistrySupport.AcpRegistryCatalog,
          catalogWithInspection({
            status: "ready",
            agentId: "test-agent",
            version: "1.0.0",
            distribution: "npx",
          }),
        ),
      );

      expect(snapshot).toMatchObject({
        installed: true,
        status: "ready",
        version: "1.0.0",
        auth: { status: "unknown" },
        message: "Checking ACP authentication, models, and commands in the background...",
      });
    }),
  );
});

it("uses discovery configuration only as a preview for its current model", () => {
  const snapshot = buildCheckedAcpRegistrySnapshot({
    ...identity,
    settings: decodeSettings({ agentId: "test-agent", customModels: ["custom"] }),
    checkedAt: "2026-10-23T00:00:00.000Z",
    inspection: { status: "ready", agentId: "test-agent", version: "1.0.0", distribution: "npx" },
    probe: {
      probe: {
        instanceId: identity.instanceId,
        ready: true,
        icon: null,
        authMethods: [],
        models: ["graded", "plain"].map((id) => ({ id, name: id, description: null })),
        currentModelId: "graded",
        configOptions: [
          {
            id: "vendor/depth",
            label: "Reasoning",
            category: "thought_level",
            type: "boolean",
            currentValue: true,
          },
        ],
        sessionManagement: noSessionManagement,
      },
      slashCommands: [],
      skills: [],
    },
  });
  expect(
    snapshot.models.map((m) => [m.slug, m.capabilities?.optionDescriptors?.map((d) => d.id)]),
  ).toEqual([
    ["graded", ["vendor/depth"]],
    ["plain", []],
    ["custom", []],
  ]);
});
