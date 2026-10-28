import {
  EnvironmentId,
  type DesktopUpdateState,
  type ServerSelfUpdateCapability,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { claimDesktopUpdateNotice } from "../desktopUpdate.logic";

import {
  collectRestartingMachines,
  collectServerUpdateTargets,
  runUpdateEverything,
  resolveSidebarUpdateActions,
  resolveSidebarUpdatePresentation,
  type UpdateEverythingMachine,
} from "./updateEverything.logic";

const clientUpdate: DesktopUpdateState = {
  enabled: true,
  status: "available",
  channel: "latest",
  currentVersion: "0.1.2-2",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
  availableVersion: "0.1.3-1",
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
  convene: {
    baseUrl: "https://platform.example/prefix",
    currentBuildId: "installed",
    releaseVersion: "0.1.3-1",
    releaseBuildId: "candidate",
    relation: "newer",
    downloadUrl: "https://platform.example/prefix/downloads/file/versions/candidate/client.deb",
    downloadsUrl: "https://platform.example/prefix/downloads/latest",
    helpUrl: "https://platform.example/prefix/help/t3code",
  },
};

describe("resolveSidebarUpdateActions", () => {
  it("keeps the T3 download available alongside Provider and environment updates", () => {
    expect(resolveSidebarUpdateActions(clientUpdate, true)).toEqual({
      clientAction: "open-download",
      runsEverything: true,
    });
  });

  it("offers the T3 download when only the client has an update", () => {
    expect(resolveSidebarUpdateActions(clientUpdate, false)).toEqual({
      clientAction: "open-download",
      runsEverything: false,
    });
  });

  it("offers only environment updates without a client update", () => {
    expect(resolveSidebarUpdateActions(null, true)).toEqual({
      clientAction: "none",
      runsEverything: true,
    });
  });
});

describe("sidebar client update discovery", () => {
  it("keeps the client download on the update icon after its notice has disappeared", () => {
    expect(
      resolveSidebarUpdatePresentation({
        state: clientUpdate,
        showsEverything: false,
        run: null,
        isDownloading: false,
        showCheckIcon: false,
        isActionPending: false,
        isClientDownloadPending: false,
      }),
    ).toMatchObject({
      action: "open-download",
      showClientDownload: true,
      iconStatus: "available",
      showUpdateDetails: true,
    });
  });

  it("keeps both actions discoverable while Provider updates run", () => {
    expect(
      resolveSidebarUpdatePresentation({
        state: clientUpdate,
        showsEverything: true,
        run: { localVersion: null, phase: "providers", restartAt: null, machines: [] },
        isDownloading: false,
        showCheckIcon: false,
        isActionPending: true,
        isClientDownloadPending: false,
      }),
    ).toMatchObject({
      isInteractionDisabled: false,
      action: "open-download",
      showClientDownload: true,
      iconStatus: "everything",
      showUpdateDetails: true,
    });
    expect(
      resolveSidebarUpdatePresentation({
        state: clientUpdate,
        showsEverything: true,
        run: { localVersion: null, phase: "providers", restartAt: null, machines: [] },
        isDownloading: false,
        showCheckIcon: false,
        isActionPending: true,
        isClientDownloadPending: true,
      }).isInteractionDisabled,
    ).toBe(true);
  });

  it("restores the download without renotifying after an offline check", () => {
    const notified = new Set<string>();
    const original = structuredClone(clientUpdate);
    expect(claimDesktopUpdateNotice(clientUpdate, notified)).toBe(true);
    expect(claimDesktopUpdateNotice({ ...clientUpdate, status: "checking" }, notified)).toBe(false);
    const failed: DesktopUpdateState = {
      ...clientUpdate,
      status: "error",
      availableVersion: null,
      errorContext: "check",
      convene: {
        ...clientUpdate.convene!,
        releaseVersion: null,
        releaseBuildId: null,
        relation: null,
        downloadUrl: null,
      },
    };
    expect(claimDesktopUpdateNotice(failed, notified)).toBe(false);
    expect(resolveSidebarUpdateActions(failed, false).clientAction).toBe("none");
    expect(claimDesktopUpdateNotice(clientUpdate, notified)).toBe(false);
    expect(resolveSidebarUpdateActions(clientUpdate, true)).toEqual({
      clientAction: "open-download",
      runsEverything: true,
    });
    expect(
      resolveSidebarUpdatePresentation({
        state: clientUpdate,
        showsEverything: true,
        run: null,
        isDownloading: false,
        showCheckIcon: false,
        isActionPending: false,
        isClientDownloadPending: false,
      }).showClientDownload,
    ).toBe(true);
    expect(clientUpdate).toEqual(original);
  });

  it("uses the existing download fallback for a new build and removes stale source actions", () => {
    const revision = {
      ...clientUpdate,
      convene: {
        ...clientUpdate.convene!,
        relation: "different-build" as const,
        releaseBuildId: "another-build",
        downloadUrl: null,
      },
    };
    const notified = new Set<string>();
    expect(claimDesktopUpdateNotice(clientUpdate, notified)).toBe(true);
    expect(claimDesktopUpdateNotice(revision, notified)).toBe(true);
    expect(resolveSidebarUpdateActions(revision, true)).toEqual({
      clientAction: "open-download",
      runsEverything: true,
    });
    const unpaired: DesktopUpdateState = {
      ...clientUpdate,
      status: "error" as const,
      availableVersion: null,
      convene: {
        ...clientUpdate.convene!,
        baseUrl: null,
        downloadUrl: null,
        downloadsUrl: null,
        relation: null,
        releaseVersion: null,
        releaseBuildId: null,
        helpUrl: null,
      },
    };
    expect(
      resolveSidebarUpdatePresentation({
        state: unpaired,
        showsEverything: true,
        run: null,
        isDownloading: false,
        showCheckIcon: false,
        isActionPending: false,
        isClientDownloadPending: false,
      }),
    ).toMatchObject({ action: "none", showClientDownload: false, iconStatus: "everything" });
  });
});

function machine(
  id: string,
  serverVersion: string,
  selfUpdate: ServerSelfUpdateCapability | undefined,
  overrides: Partial<UpdateEverythingMachine> = {},
): UpdateEverythingMachine {
  return {
    environmentId: EnvironmentId.make(id),
    label: id,
    serverConfig: {
      environment: {
        environmentId: EnvironmentId.make(id),
        label: id,
        platform: { os: "linux", arch: "x64" },
        serverVersion,
        capabilities: {
          repositoryIdentity: true,
          ...(selfUpdate ? { serverSelfUpdate: selfUpdate } : {}),
          ...(selfUpdate === "desktop-managed" ? { desktopAppUpdate: true } : {}),
        },
      },
      settings: { continueThreadsAfterServerUpdate: false },
    },
    connected: true,
    hostedByThisApp: false,
    canMaintain: true,
    updateState: { status: "idle" },
    ...overrides,
  };
}

describe("collectServerUpdateTargets", () => {
  it("updates remote servers that can move to the target and names every skipped one", () => {
    const { targets, skipped } = collectServerUpdateTargets(
      [
        machine("this-app", "0.0.40", "desktop-managed", { hostedByThisApp: true }),
        machine("service", "0.0.40", "boot-service"),
        machine("nightly-service", "0.0.49-nightly.20261001.3", "boot-service"),
        machine("other-desktop", "0.0.49-nightly.20261001.3", "desktop-managed"),
        machine("offline", "0.0.40", "boot-service", { connected: false }),
        machine("never-connected", "0.0.40", "boot-service", { serverConfig: null }),
        machine("no-scope", "0.0.40", "boot-service", { canMaintain: false }),
        machine("busy", "0.0.40", "boot-service", {
          updateState: {
            status: "running",
            stage: "downloading",
            fromVersion: "0.0.40",
            targetVersion: "0.0.50",
          },
        }),
        machine("current", "0.0.50", "boot-service"),
        machine("current-offline", "0.0.50", "boot-service", { connected: false }),
        machine("manual", "0.0.40", undefined),
      ],
      "0.0.50",
    );

    expect(targets.map((target) => [target.serverLabel, target.targetVersion])).toEqual([
      ["service", "0.0.50"],
      ["other-desktop", "0.0.50"],
    ]);
    expect(skipped.map((entry) => [entry.label, entry.reason])).toEqual([
      ["nightly-service", "on the nightly channel"],
      ["offline", "not connected"],
      ["never-connected", "not connected"],
      ["no-scope", "no permission"],
      ["busy", "already updating"],
      ["manual", "needs a manual update"],
    ]);
  });
});

describe("collectRestartingMachines", () => {
  it("lists updated servers, and this app's servers only when it installs", () => {
    const withContinuation = (
      id: string,
      overrides: Partial<UpdateEverythingMachine> = {},
      enabled = false,
    ) => {
      const base = machine(id, "0.0.40", "boot-service", overrides);
      return {
        ...base,
        serverConfig: {
          environment: {
            ...base.serverConfig!.environment,
            capabilities: {
              ...base.serverConfig!.environment.capabilities,
              threadRestartContinuation: true,
            },
          },
          settings: { continueThreadsAfterServerUpdate: enabled },
        },
      };
    };
    const machines = [
      withContinuation("this-app", { hostedByThisApp: true }, true),
      withContinuation("alvin", {}, true),
      withContinuation("opted-out", {}, false),
      machine("old", "0.0.40", "boot-service"),
      withContinuation("providers-only"),
    ];
    const servers = ["alvin", "opted-out", "old"].map((id) => ({
      environmentId: EnvironmentId.make(id),
    }));

    expect(collectRestartingMachines(machines, servers, true)).toEqual([
      { environmentId: "this-app", continuesThreads: true },
      { environmentId: "alvin", continuesThreads: true },
      { environmentId: "opted-out", continuesThreads: false },
      { environmentId: "old", continuesThreads: false },
    ]);
    expect(
      collectRestartingMachines(machines, servers, false).map((entry) => entry.environmentId),
    ).toEqual(["alvin", "opted-out", "old"]);
  });
});

describe("runUpdateEverything", () => {
  it("still updates remote machines when the local download fails", async () => {
    const calls: string[] = [];
    const result = await runUpdateEverything({
      downloadLocal: async () => false,
      updateProviders: async () => {
        calls.push("providers");
      },
      updateServers: async () => {
        calls.push("servers");
      },
    });

    expect(calls).toEqual(["providers", "servers"]);
    expect(result.localReady).toBe(false);
  });
});
