import { createI18n, resolveLanguage } from "@t3tools/client-runtime/i18n";
import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Electron from "electron";

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopState from "../app/DesktopState.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import { LinuxTrayHost } from "./LinuxTrayHost.ts";

class DesktopTraySetupError extends Schema.TaggedError<DesktopTraySetupError>()(
  "DesktopTraySetupError",
  { platform: Schema.String, cause: Schema.Defect() },
) {}

export class DesktopTray extends Context.Service<
  DesktopTray,
  {
    readonly configure: (open: () => void) => Effect.Effect<void>;
    readonly syncLanguage: (settings: ClientSettings) => Effect.Effect<void>;
    readonly closeMain: (window: Electron.BrowserWindow) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopTray") {}

const { logWarning } = makeComponentLogger("desktop-tray");

const make = Effect.gen(function* () {
  const assets = yield* DesktopAssets.DesktopAssets;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const state = yield* DesktopState.DesktopState;
  const app = yield* ElectronApp.ElectronApp;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const settings = yield* DesktopAppSettings.DesktopAppSettings;
  const dialog = yield* ElectronDialog.ElectronDialog;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const i18n = createI18n();
  let tray: Electron.Tray | undefined;
  let openMain: (() => void) | undefined;
  let closing = false;
  let linuxHost: LinuxTrayHost | undefined;
  let hiddenWindow: Electron.BrowserWindow | undefined;
  const restoreTaskbarEntry = () => {
    const window = hiddenWindow;
    hiddenWindow = undefined;
    if (!window) return;
    return runPromise(
      Effect.gen(function* () {
        if (window.isDestroyed() || window.isVisible() || (yield* Ref.get(state.quitting))) return;
        window.setSkipTaskbar(false);
        window.showInactive();
        window.minimize();
      }).pipe(
        Effect.catchCause((cause) => logWarning("could not restore the taskbar entry", { cause })),
      ),
    );
  };
  const discardTray = Effect.sync(() => {
    linuxHost?.close();
    linuxHost = undefined;
    tray?.destroy();
    tray = undefined;
    restoreTaskbarEntry();
  });

  const canUseTray = Effect.fn("desktop.tray.canUseTray")(function* () {
    if (!tray || tray.isDestroyed()) return false;
    if (environment.platform !== "linux") return true;
    return linuxHost ? yield* Effect.promise(() => linuxHost!.isAvailable()) : false;
  });

  const translate = Effect.fn("desktop.tray.translate")(function* () {
    const stored = yield* clientSettings.get.pipe(
      Effect.catch(() => Effect.succeed(Option.none<ClientSettings>())),
    );
    const systemLocale = yield* app.systemLocale;
    return i18n.getFixedT(
      resolveLanguage(Option.getOrElse(stored, () => DEFAULT_CLIENT_SETTINGS).languagePreference, [
        systemLocale,
      ]),
    );
  });

  const syncLanguage = Effect.fn("desktop.tray.syncLanguage")(
    function* (settings: ClientSettings) {
      if (!tray || tray.isDestroyed()) return;
      const systemLocale = yield* app.systemLocale;
      const t = i18n.getFixedT(resolveLanguage(settings.languagePreference, [systemLocale]));
      const menu = Electron.Menu.buildFromTemplate([
        { label: environment.displayName, enabled: false },
        { type: "separator" },
        {
          label: t("desktop.tray.open", { defaultValue: "Open T3 Code" }),
          click: () => openMain?.(),
        },
        {
          label: t("desktop.tray.quit", { defaultValue: "Quit T3 Code completely" }),
          click: () => {
            void runPromise(app.quit);
          },
        },
      ]);
      tray.setContextMenu(menu);
      tray.setToolTip(environment.displayName);
    },
    Effect.catchCause((cause) =>
      discardTray.pipe(
        Effect.andThen(
          logWarning("tray menu unavailable; retaining a window recovery entry", { cause }),
        ),
      ),
    ),
  );

  yield* Effect.addFinalizer(() => discardTray);

  return DesktopTray.of({
    configure: Effect.fn("desktop.tray.configure")(
      function* (open) {
        openMain = open;
        if (tray && !tray.isDestroyed()) return;
        const icons = yield* assets.iconPaths;
        const path = environment.platform === "win32" ? icons.ico : icons.png;
        if (Option.isNone(path)) {
          yield* logWarning("tray icon missing; retaining a window recovery entry");
          return;
        }
        yield* Effect.try({
          try: () => {
            const image = Electron.nativeImage.createFromPath(path.value);
            if (image.isEmpty()) throw new Error("Tray icon is empty");
            tray = new Electron.Tray(
              environment.platform === "darwin" ? image.resize({ width: 18, height: 18 }) : image,
            );
            tray.on("click", () => openMain?.());
            tray.on("double-click", () => openMain?.());
          },
          catch: (cause) => new DesktopTraySetupError({ platform: environment.platform, cause }),
        });
        const settings = yield* clientSettings.get.pipe(
          Effect.catch(() => Effect.succeed(Option.none<ClientSettings>())),
        );
        yield* syncLanguage(Option.getOrElse(settings, () => DEFAULT_CLIENT_SETTINGS));
        if (environment.platform === "linux" && tray && !tray.isDestroyed()) {
          linuxHost = new LinuxTrayHost(restoreTaskbarEntry);
        }
      },
      Effect.catchCause((cause) =>
        discardTray.pipe(
          Effect.andThen(
            logWarning("tray unavailable; retaining a window recovery entry", { cause }),
          ),
        ),
      ),
    ),
    syncLanguage,
    closeMain: Effect.fn("desktop.tray.closeMain")(function* (window) {
      if (closing || window.isDestroyed() || (yield* Ref.get(state.quitting))) return;
      closing = true;
      yield* Effect.gen(function* () {
        if (!(yield* settings.get).trayCloseNoticeShown) {
          const t = yield* translate();
          const taskbarRecovery = !(yield* canUseTray());
          yield* dialog.showMessageBox(
            {
              type: "info",
              title: t("desktop.tray.notice.title", { defaultValue: "T3 Code keeps running" }),
              message: t("desktop.tray.notice.message", {
                defaultValue:
                  "Closing the window keeps your hosted environments and tasks running.",
              }),
              detail: taskbarRecovery
                ? t("desktop.tray.notice.taskbar", {
                    defaultValue:
                      "Reopen T3 Code from the taskbar or app launcher. Use Quit T3 Code completely in the app or tray menu to stop this desktop and its hosted environments.",
                  })
                : t("desktop.tray.notice.tray", {
                    defaultValue:
                      "Reopen T3 Code from its tray or menu bar icon, or launch the app again. Use Quit T3 Code completely in the app or tray menu to stop this desktop and its hosted environments.",
                  }),
              buttons: [t("common.ok")],
            },
            window,
          );
          yield* settings.markTrayCloseNoticeShown.pipe(
            Effect.catch((cause) => logWarning("could not persist the close notice", { cause })),
          );
        }
        if (window.isDestroyed() || (yield* Ref.get(state.quitting))) return;
        if (!(yield* canUseTray())) {
          window.setSkipTaskbar(false);
          window.minimize();
        } else {
          hiddenWindow = window;
          window.hide();
        }
      }).pipe(
        Effect.catch((cause) =>
          logWarning("could not close the main window to the background", { cause }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            closing = false;
          }),
        ),
      );
    }),
  });
});

export const layer = Layer.effect(DesktopTray, make);
