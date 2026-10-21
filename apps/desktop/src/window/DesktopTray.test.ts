import { assert, describe, it } from "@effect/vitest";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as NodeEvents from "node:events";
import type * as Electron from "electron";
import { vi } from "vite-plus/test";

const native = vi.hoisted(() => ({
  fail: false,
  trays: [] as Array<{
    destroyed: boolean;
    destroy: () => void;
    emit: (event: string) => boolean;
    menu: Electron.MenuItemConstructorOptions[];
  }>,
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    nativeImage: {
      createFromPath: () => ({
        isEmpty: () => false,
        resize() {
          return this;
        },
      }),
    },
    Menu: { buildFromTemplate: (template: Electron.MenuItemConstructorOptions[]) => template },
    Tray: class extends EventEmitter {
      destroyed = false;
      menu: Electron.MenuItemConstructorOptions[] = [];
      constructor() {
        super();
        if (native.fail) throw new Error("No tray host");
        native.trays.push(this);
      }
      isDestroyed() {
        return this.destroyed;
      }
      destroy() {
        this.destroyed = true;
      }
      setContextMenu(menu: Electron.MenuItemConstructorOptions[]) {
        this.menu = menu;
      }
      setToolTip() {}
    },
  };
});

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopTray from "./DesktopTray.ts";

function setup(
  platform: NodeJS.Platform,
  notice: Effect.Effect<void> = Effect.void,
  quitEffect: Effect.Effect<void> = Effect.void,
) {
  native.fail = false;
  native.trays = [];
  let notices = 0;
  const quit = vi.fn();
  const window = Object.assign(new NodeEvents.EventEmitter(), {
    isDestroyed: () => false,
    setSkipTaskbar: vi.fn(),
    minimize: vi.fn(),
    hide: vi.fn(),
  });
  const layer = DesktopTray.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
          platform,
          displayName: "T3 Code for Convene",
        } as DesktopEnvironment.DesktopEnvironment["Service"]),
        Layer.succeed(DesktopAssets.DesktopAssets, {
          iconPaths: Effect.succeed({
            png: Option.some("/mock/icon.png"),
            ico: Option.some("/mock/icon.ico"),
            icns: Option.none<string>(),
          }),
          resolveResourcePath: () => Effect.succeedNone,
        }),
        Layer.mock(ElectronApp.ElectronApp)({
          systemLocale: Effect.succeed("en-US"),
          quit: Effect.sync(quit).pipe(Effect.andThen(quitEffect)),
        }),
        Layer.mock(DesktopClientSettings.DesktopClientSettings)({
          get: Effect.succeedSome({ ...DEFAULT_CLIENT_SETTINGS, languagePreference: "en" }),
        }),
        Layer.mock(ElectronDialog.ElectronDialog)({
          showMessageBox: () =>
            Effect.sync(() => {
              notices += 1;
            }).pipe(Effect.andThen(notice), Effect.as({ response: 0, checkboxChecked: false })),
        }),
        DesktopAppSettings.layerTest(),
        DesktopState.layer,
      ),
    ),
  );
  return { layer, window, quit, notices: () => notices };
}

describe("DesktopTray", () => {
  it.effect.each(["linux", "win32", "darwin"] satisfies NodeJS.Platform[])(
    "keeps the desktop alive with a recoverable window on %s, then reopens and explicitly quits",
    (platform) =>
      Effect.gen(function* () {
        const quitSeen = yield* Deferred.make<void>();
        const h = setup(
          platform,
          Effect.void,
          Deferred.succeed(quitSeen, undefined).pipe(Effect.asVoid),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const service = yield* DesktopTray.DesktopTray;
            const settings = yield* DesktopAppSettings.DesktopAppSettings;
            let opens = 0;
            yield* service.configure(() => {
              opens += 1;
            });
            yield* service.closeMain(h.window as unknown as Electron.BrowserWindow);
            assert.equal(h.notices(), 1);
            assert.isTrue((yield* settings.get).trayCloseNoticeShown);
            assert.equal(h.quit.mock.calls.length, 0);
            assert.equal(h.window.minimize.mock.calls.length, platform === "linux" ? 1 : 0);
            assert.equal(h.window.hide.mock.calls.length, platform === "linux" ? 0 : 1);
            yield* service.closeMain(h.window as unknown as Electron.BrowserWindow);
            assert.equal(h.notices(), 1);
            assert.equal(native.trays.length, 1);
            const tray = native.trays[0]!;
            tray.emit("click");
            assert.equal(opens, 1);
            // The native menu uses the same reopen callback, not a new desktop/server.
            tray.menu
              .find((entry) => entry.label === "Open T3 Code")
              ?.click?.(
                {} as Electron.MenuItem,
                {} as Electron.BaseWindow,
                {} as Electron.KeyboardEvent,
              );
            assert.equal(opens, 2);
            tray.menu
              .find((entry) => entry.label === "Quit T3 Code completely")
              ?.click?.(
                {} as Electron.MenuItem,
                {} as Electron.BaseWindow,
                {} as Electron.KeyboardEvent,
              );
            yield* Deferred.await(quitSeen);
            assert.equal(h.quit.mock.calls.length, 1);
          }).pipe(Effect.provide(h.layer)),
        );
        // The service owns and releases the native Tray for the application scope.
        assert.isTrue(native.trays[0]!.destroyed);
      }),
  );

  it.effect("minimizes into the taskbar when a tray cannot be created", () =>
    Effect.gen(function* () {
      const h = setup("win32");
      native.fail = true;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* DesktopTray.DesktopTray;
          yield* service.configure(() => {});
          yield* service.closeMain(h.window as unknown as Electron.BrowserWindow);
          assert.equal(h.window.hide.mock.calls.length, 0);
          assert.deepEqual(h.window.setSkipTaskbar.mock.calls, [[false]]);
          assert.equal(h.window.minimize.mock.calls.length, 1);
          assert.equal(h.quit.mock.calls.length, 0);
        }).pipe(Effect.provide(h.layer)),
      );
    }),
  );

  it.effect("does not conceal a window after quit begins while the first notice is open", () =>
    Effect.gen(function* () {
      const noticeOpen = yield* Deferred.make<void>();
      const dismiss = yield* Deferred.make<void>();
      const h = setup(
        "win32",
        Deferred.succeed(noticeOpen, undefined).pipe(Effect.andThen(Deferred.await(dismiss))),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* DesktopTray.DesktopTray;
          const state = yield* DesktopState.DesktopState;
          const closed = yield* service
            .closeMain(h.window as unknown as Electron.BrowserWindow)
            .pipe(Effect.forkChild({ startImmediately: true }));
          yield* Deferred.await(noticeOpen);
          yield* service.closeMain(h.window as unknown as Electron.BrowserWindow);
          assert.equal(h.notices(), 1);
          yield* Ref.set(state.quitting, true);
          yield* Deferred.succeed(dismiss, undefined);
          yield* Fiber.join(closed);
          assert.equal(h.window.hide.mock.calls.length, 0);
          assert.equal(h.window.minimize.mock.calls.length, 0);
        }).pipe(Effect.provide(h.layer)),
      );
    }),
  );
});
