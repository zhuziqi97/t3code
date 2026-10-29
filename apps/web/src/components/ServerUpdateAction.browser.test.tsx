import { type ServerInstallation } from "@t3tools/contracts";
import {
  readConfirmDialogState,
  subscribeConfirmDialogHost,
  respondToConfirmDialog,
} from "~/confirmDialog";
import { ServerUpdateProgress } from "./ServerUpdateAction";
import "~/index.css";
import { act, render, type Screen } from "../../test/render";

import { changeLanguage } from "../i18n";
import { RegistryContext } from "@effect/atom-react";
import { AuthSessionState, type EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

type SessionResult = AsyncResult.AsyncResult<AuthSessionState, Error>;
const testState = vi.hoisted(() => ({
  updateServer: vi.fn(),
  toast: vi.fn(),
  clipboard: vi.fn(),
  sessionAtom: null as unknown,
  serverVersions: new Map<string, string>(),
  serverSettings: new Map<string, { continueThreadsAfterServerUpdate: boolean }>(),
}));

vi.mock(import("~/hooks/useCopyToClipboard"), async (original) => ({
  ...(await original()),
  useCopyToClipboard: ((options: { onCopy: (context: { command: string }) => void }) => ({
    copyToClipboard: (command: string, context: { command: string }) => {
      testState.clipboard(command);
      options.onCopy(context);
    },
    isCopied: false,
  })) as never,
}));
vi.mock(import("~/state/session"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    environmentSession: {
      ...actual.environmentSession,
      sessionStateAtom: (() => testState.sessionAtom) as never,
    },
  };
});
vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useServerConfigs: (() =>
    new Map(
      [...testState.serverVersions].map(([id, serverVersion]) => [
        id,
        { environment: { serverVersion }, settings: testState.serverSettings.get(id) },
      ]),
    )) as never,
}));
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => testState.updateServer) as never,
}));
vi.mock(import("./ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: testState.toast } };
});

import { resetConfirmDialogForTests } from "~/confirmDialog";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import {
  ServerUpdateAction,
  ServerUpdatesAction,
  type ServerUpdateTarget,
} from "./ServerUpdateAction";

const decodeSessionState = Schema.decodeUnknownSync(AuthSessionState);

const legacyAuth = {
  policy: "remote-reachable",
  bootstrapMethods: ["one-time-token"],
  sessionMethods: ["bearer-access-token"],
  sessionCookieName: "t3_session",
} as const;

const currentSession = {
  authenticated: true,
  scopes: ["environment:maintain"],
  auth: {
    ...legacyAuth,
    serverUpdateScope: "environment:maintain",
  },
} as const satisfies AuthSessionState;

const success = (method: "boot-service" | "desktop-app" = "boot-service", version = "0.0.31") =>
  AsyncResult.success({ targetVersion: version, method });

let sessionAtom: Atom.Writable<SessionResult>;

function setSession(session: SessionResult) {
  appAtomRegistry.set(sessionAtom, session);
}

function setup(): Disposable {
  testState.updateServer.mockReset();
  testState.toast.mockReset();
  testState.clipboard.mockReset();
  testState.serverVersions.clear();
  testState.serverSettings.clear();
  sessionAtom = Atom.make<SessionResult>(AsyncResult.success(currentSession));
  testState.sessionAtom = sessionAtom;
  resetConfirmDialogForTests();
  return { [Symbol.dispose]: resetConfirmDialogForTests };
}

function renderUpdate(element: ReactNode) {
  return render(
    <RegistryContext.Provider value={appAtomRegistry}>{element}</RegistryContext.Provider>,
  );
}

function button(screen: Screen, name?: string) {
  const buttons = [...screen.container.querySelectorAll("button")];
  return name === undefined
    ? buttons[0]
    : buttons.find((element) => element.textContent?.trim() === name);
}

async function click(screen: Screen, name?: string) {
  await act(async () => button(screen, name)!.click());
}

function renderAction(props: Partial<Parameters<typeof ServerUpdateAction>[0]> = {}) {
  return renderUpdate(
    <ServerUpdateAction
      environmentId={"env-test" as EnvironmentId}
      serverLabel="Test server"
      selfUpdate="boot-service"
      targetVersion="0.0.31"
      {...props}
    />,
  );
}

describe("ServerUpdateAction", () => {
  it.each([
    { serverUpdateScope: undefined, scopes: ["orchestration:operate"], allowed: true },
    { serverUpdateScope: undefined, scopes: ["orchestration:read"], allowed: false },
    {
      serverUpdateScope: "environment:maintain",
      scopes: ["orchestration:operate"],
      allowed: false,
    },
    {
      serverUpdateScope: "environment:maintain",
      scopes: ["environment:maintain"],
      allowed: true,
    },
  ] as const)(
    "uses the advertised update scope $serverUpdateScope with grant $scopes",
    async ({ serverUpdateScope, scopes, allowed }) => {
      await using _lifecycle = await setupLifecycle();

      using _state = setup();
      setSession(
        AsyncResult.success(
          decodeSessionState({
            ...currentSession,
            scopes,
            auth: {
              ...legacyAuth,
              ...(serverUpdateScope === undefined ? {} : { serverUpdateScope }),
            },
          }),
        ),
      );
      testState.updateServer.mockResolvedValue(success());

      await using screen = await renderAction();
      expect(button(screen, "Update")!.disabled).toBe(!allowed);
      await click(screen, "Update");

      expect(testState.updateServer).toHaveBeenCalledTimes(allowed ? 1 : 0);
    },
  );

  it("keeps a known grant usable while the session refreshes", async () => {
    await using _lifecycle = await setupLifecycle();

    using _state = setup();
    setSession(AsyncResult.waiting(AsyncResult.success(currentSession)));
    testState.updateServer.mockResolvedValue(success());

    await using screen = await renderAction();
    await click(screen, "Update");

    expect(testState.updateServer).toHaveBeenCalledOnce();
  });

  it("disables the action once maintenance access is removed", async () => {
    await using _lifecycle = await setupLifecycle();

    using _state = setup();
    await using screen = await renderAction();
    await act(() => setSession(AsyncResult.success({ ...currentSession, scopes: [] })));
    expect(button(screen, "Update")!.disabled).toBe(true);
    await click(screen, "Update");
    expect(testState.updateServer).not.toHaveBeenCalled();
  });

  it.each([
    [
      { kind: "npm-global", prefix: "/opt/node" },
      "Copy update command",
      "npm install --global --prefix '/opt/node' t3@0.0.45",
      "Update command copied",
      "then restart t3",
    ],
    [
      { kind: "npx" },
      "Copy relaunch command",
      "npx t3@0.0.45",
      "Relaunch command copied",
      "This does not update an installed t3 command.",
    ],
    [
      undefined,
      "Copy relaunch command",
      "npx t3@0.0.45",
      "Relaunch command copied",
      "This does not update an installed t3 command.",
    ],
  ] satisfies ReadonlyArray<
    readonly [ServerInstallation | undefined, string, string, string, string]
  >)(
    "copies an honest manual command for %j without invoking remote update",
    async (installation, label, command, title, guidance) => {
      await using _lifecycle = await setupLifecycle();

      using _state = setup();
      await using screen = await renderAction({
        selfUpdate: null,
        installation,
        targetVersion: "0.0.45",
      });
      await click(screen, label);
      expect(testState.clipboard).toHaveBeenCalledWith(command);
      expect(testState.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title,
          description: expect.stringContaining(guidance),
        }),
      );
      expect(testState.updateServer).not.toHaveBeenCalled();
    },
  );

  it("reports success only after the shared update flow reconnects", async () => {
    await using _lifecycle = await setupLifecycle();

    using _state = setup();
    testState.updateServer.mockResolvedValue(success());

    await using screen = await renderAction();
    await click(screen, "Update");

    expect(testState.updateServer).toHaveBeenCalledWith({
      environmentId: "env-test",
      input: { targetVersion: "0.0.31" },
    });
    expect(testState.toast).toHaveBeenCalledWith({
      type: "success",
      title: "Test server updated",
      description: "Reconnected on t3@0.0.31.",
    });
  });

  it("reports one result when the update action is double-clicked", async () => {
    await using _lifecycle = await setupLifecycle();

    using _state = setup();
    let finishUpdate: (() => void) | undefined;
    testState.updateServer.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishUpdate = () => resolve(success());
        }),
    );

    await using screen = await renderAction();
    await act(async () => {
      button(screen, "Update")!.click();
      button(screen, "Update")!.click();
    });

    expect(testState.updateServer).toHaveBeenCalledTimes(1);
    await act(async () => finishUpdate?.());
    expect(testState.toast).toHaveBeenCalledTimes(1);
  });

  it("quietly releases the action when the operation is interrupted", async () => {
    await using _lifecycle = await setupLifecycle();

    using _state = setup();
    testState.updateServer.mockResolvedValue(AsyncResult.failure(Cause.interrupt()));

    await using screen = await renderAction();
    await click(screen, "Update");

    expect(testState.toast).not.toHaveBeenCalled();
  });

  it("keeps the manual instruction for desktop servers without remote update support", async () => {
    await using _lifecycle = await setupLifecycle();

    using _state = setup();
    await using screen = await renderAction({ selfUpdate: "desktop-managed" });

    expect(screen.container.textContent).toBe(
      "Update the desktop app on that machine to update this server.",
    );
    expect(button(screen)).toBeUndefined();
  });

  it("updates remote desktop apps through the shared update flow after confirmation", async () => {
    await using _lifecycle = await setupLifecycle();

    using _state = setup();
    subscribeConfirmDialogHost(() => {});
    testState.updateServer.mockResolvedValue(success("desktop-app", "0.0.34"));

    await using screen = await renderAction({
      selfUpdate: "desktop-managed",
      desktopAppUpdate: true,
    });
    await click(screen, "Update");
    expect(readConfirmDialogState()).toEqual(
      expect.objectContaining({
        status: "confirming",
        message: expect.stringContaining("Test server"),
      }),
    );
    await act(async () => respondToConfirmDialog(true));

    expect(testState.updateServer).toHaveBeenCalledWith({
      environmentId: "env-test",
      input: { targetVersion: "0.0.31" },
    });
    expect(testState.toast).toHaveBeenCalledWith({
      type: "success",
      title: "Test server updated",
      description: "Desktop app relaunched on 0.0.34.",
    });
  });

  it.each([false, true])(
    "leaves the saved continuation preference %s to the target environment",
    async (continueThreadsAfterServerUpdate) => {
      await using _lifecycle = await setupLifecycle();

      using _state = setup();
      testState.updateServer.mockResolvedValue(success());
      testState.serverVersions.set("env-test", "0.0.30");
      testState.serverSettings.set("env-test", { continueThreadsAfterServerUpdate });

      await using screen = await renderAction();
      await click(screen, "Update");

      expect(testState.updateServer).toHaveBeenCalledExactlyOnceWith({
        environmentId: "env-test",
        input: { targetVersion: "0.0.31" },
      });
    },
  );

  it.each(["success", "failure"] as const)(
    "uses the completion language for a delayed %s and keeps raw result details",
    async (outcome) => {
      await using _lifecycle = await setupLifecycle();

      using _state = setup();
      let finishUpdate: (() => void) | undefined;
      testState.updateServer.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishUpdate = () =>
              resolve(
                outcome === "success"
                  ? AsyncResult.success({
                      targetVersion: "0.0.45-nightly.20261010.17",
                      method: "boot-service" as const,
                    })
                  : AsyncResult.failure(Cause.fail(new Error("Network /tmp/原文 404"))),
              );
          }),
      );
      await using screen = await renderAction();
      await click(screen);
      expect(testState.toast).not.toHaveBeenCalled();
      await changeLanguage("zh");
      await act(async () => finishUpdate?.());
      expect(testState.toast).toHaveBeenCalledWith(
        outcome === "success"
          ? {
              type: "success",
              title: "Test server 已更新",
              description: "已重新连接，当前版本为 t3@0.0.45-nightly.20261010.17。",
            }
          : { type: "error", title: "Test server 更新失败", description: "Network /tmp/原文 404" },
      );
    },
  );
});

describe("ServerUpdatesAction", () => {
  const targets: ReadonlyArray<ServerUpdateTarget> = [
    {
      environmentId: "batch-a" as EnvironmentId,
      serverLabel: "Laptop",
      selfUpdate: "boot-service",
      targetVersion: "0.0.31",
    },
    {
      environmentId: "batch-b" as EnvironmentId,
      serverLabel: "Office",
      selfUpdate: "respawn",
      targetVersion: "0.0.31",
    },
    {
      environmentId: "batch-c" as EnvironmentId,
      serverLabel: "Manual",
      selfUpdate: null,
      targetVersion: "0.0.31",
    },
  ];

  const mount = (batch = targets) => renderUpdate(<ServerUpdatesAction targets={batch} />);

  it("updates both supported machines without overriding their continuation preferences and skips the manual machine", async () => {
    await using _lifecycle = await setupLifecycle();

    using _state = setup();
    testState.updateServer.mockResolvedValue(success());
    testState.serverVersions.set("batch-a", "0.0.30");
    testState.serverVersions.set("batch-b", "0.0.30");
    testState.serverSettings.set("batch-a", { continueThreadsAfterServerUpdate: true });
    testState.serverSettings.set("batch-b", { continueThreadsAfterServerUpdate: false });
    await using screen = await mount();
    await click(screen, "Update all");

    expect(testState.updateServer.mock.calls.map(([target]) => target)).toEqual([
      {
        environmentId: "batch-a",
        input: { targetVersion: "0.0.31" },
      },
      { environmentId: "batch-b", input: { targetVersion: "0.0.31" } },
    ]);
    expect(testState.toast.mock.calls.map(([toast]) => toast.title)).toEqual([
      "Laptop updated",
      "Office updated",
    ]);
  });

  it("names a failed machine while letting the other machine complete", async () => {
    await using _lifecycle = await setupLifecycle();

    using _state = setup();
    testState.updateServer
      .mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Download failed"))))
      .mockResolvedValueOnce(success());
    await using screen = await mount();
    await click(screen, "Update all");

    expect(testState.updateServer).toHaveBeenCalledTimes(2);
    expect(testState.toast).toHaveBeenCalledWith({
      type: "error",
      title: "Laptop update failed",
      description: "Download failed",
    });
    expect(testState.toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success", title: "Office updated" }),
    );
    expect(button(screen, "Update all")!.disabled).toBe(false);
  });

  it("starts each machine once when double-clicked and disables the action until both finish", async () => {
    await using _lifecycle = await setupLifecycle();

    using _state = setup();
    const completions: Array<() => void> = [];
    testState.updateServer.mockImplementation(
      () =>
        new Promise((resolve) => {
          completions.push(() => resolve(success()));
        }),
    );
    await using screen = await mount();
    await act(async () => {
      button(screen, "Update all")!.click();
      button(screen, "Update all")!.click();
    });
    expect(testState.updateServer).toHaveBeenCalledTimes(2);
    expect(button(screen, "Update all")!.disabled).toBe(true);
    await act(async () => completions[0]!());
    expect(button(screen, "Update all")!.disabled).toBe(true);
    await act(async () => completions[1]!());
    expect(button(screen, "Update all")!.disabled).toBe(false);
    expect(testState.toast).toHaveBeenCalledTimes(2);
  });

  it("asks once for desktop machines and cancels the entire batch", async () => {
    await using _lifecycle = await setupLifecycle();

    using _state = setup();
    subscribeConfirmDialogHost(() => {});
    await using screen = await mount(
      targets.map((target, index) =>
        index < 2 ? { ...target, selfUpdate: "desktop-managed", desktopAppUpdate: true } : target,
      ),
    );
    await click(screen, "Update all");
    expect(readConfirmDialogState()).toEqual(
      expect.objectContaining({
        status: "confirming",
        message: expect.stringContaining("Laptop, Office"),
      }),
    );
    expect(testState.updateServer).not.toHaveBeenCalled();
    await act(async () => respondToConfirmDialog(false));
    expect(testState.updateServer).not.toHaveBeenCalled();
    expect(button(screen, "Update all")!.disabled).toBe(false);
  });

  it("skips a machine whose update would cross Stable and Nightly", async () => {
    using _state = setup();
    testState.serverVersions.set("batch-a", "0.0.30-nightly.20261001.1");
    testState.updateServer.mockResolvedValue(success());
    await using screen = await mount();
    await click(screen, "Update all");

    expect(testState.updateServer).toHaveBeenCalledTimes(1);
    expect(testState.toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success", title: "Office updated" }),
    );
  });
});

describe("ServerUpdateProgress", () => {
  it("shows one calm status for the restart wait", async () => {
    await using _lifecycle = await setupLifecycle();

    using _state = setup();
    await using screen = await renderUpdate(
      <ServerUpdateProgress
        state={{
          status: "running",
          stage: "resuming",
          fromVersion: "0.0.30",
          targetVersion: "0.0.31",
        }}
      />,
    );
    expect(screen.container.textContent).toBe("Restarting…");
  });

  it("folds the sub-second installing handoff into the download phase", async () => {
    await using _lifecycle = await setupLifecycle();

    using _state = setup();
    await using screen = await renderUpdate(
      <ServerUpdateProgress
        state={{
          status: "running",
          stage: "installing",
          fromVersion: "0.0.30",
          targetVersion: "0.0.31",
        }}
      />,
    );
    expect(screen.container.textContent).toBe("Downloading…");
  });

  it("keeps the failure visible as an alert with its error", async () => {
    await using _lifecycle = await setupLifecycle();

    using _state = setup();
    await using screen = await renderUpdate(
      <ServerUpdateProgress
        state={{
          status: "failed",
          stage: "installing",
          fromVersion: "0.0.30",
          targetVersion: "0.0.31",
          message: "The package could not be verified.",
        }}
      />,
    );
    expect(screen.container.querySelector("[role=alert]")?.textContent).toBe(
      "The package could not be verified.",
    );
  });
});

async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  stack.defer(async () => {
    await changeLanguage("en");
  });

  return stack.move();
}
