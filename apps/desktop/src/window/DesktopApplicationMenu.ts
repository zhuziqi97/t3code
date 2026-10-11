import {
  createI18n,
  formatDesktopUpdateMessage,
  resolveLanguage,
  type SupportedLanguage,
} from "@t3tools/client-runtime/i18n";
import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type * as Electron from "electron";

import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

export class DesktopApplicationMenuActionError extends Schema.TaggedError<DesktopApplicationMenuActionError>()(
  "DesktopApplicationMenuActionError",
  {
    action: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop menu action "${this.action}" failed.`;
  }
}

export class DesktopApplicationMenu extends Context.Service<
  DesktopApplicationMenu,
  {
    readonly configure: Effect.Effect<void, DesktopClientSettings.DesktopClientSettingsReadError>;
    readonly syncLanguage: (settings: ClientSettings) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopApplicationMenu") {}

type DesktopApplicationMenuRuntimeServices =
  | DesktopUpdates.DesktopUpdates
  | DesktopWindow.DesktopWindow
  | ElectronDialog.ElectronDialog;

const { logInfo: logUpdaterInfo } = makeComponentLogger("desktop-updater");

const { logError: logMenuError } = makeComponentLogger("desktop-menu");

const dispatchMenuAction = Effect.fn("desktop.menu.dispatchMenuAction")(function* (
  action: string,
): Effect.fn.Return<void, DesktopWindow.DesktopWindowError, DesktopWindow.DesktopWindow> {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.dispatchMenuAction(action, {
    reveal: action !== "paste-as-text",
  });
});

const zoomMainWindow = Effect.fn("desktop.menu.zoomMainWindow")(function* (
  direction: DesktopWindow.MainWindowZoomDirection,
): Effect.fn.Return<void, never, DesktopWindow.DesktopWindow> {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.zoomMain(direction);
});

const runMainContentsCommand = Effect.fn("desktop.menu.runMainContentsCommand")(function* (
  command: DesktopWindow.MainWindowContentsCommand,
): Effect.fn.Return<void, never, DesktopWindow.DesktopWindow> {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.runMainContentsCommand(command);
});

type MenuTranslate = ReturnType<typeof createI18n>["t"];

const checkForUpdatesFromMenu = Effect.fn("desktop.menu.checkForUpdates")(function* (
  getTranslate: () => MenuTranslate,
) {
  const updates = yield* DesktopUpdates.DesktopUpdates;
  const electronDialog = yield* ElectronDialog.ElectronDialog;
  const result = yield* updates.check("menu");
  const updateState = result.state;
  const t = getTranslate();

  if (updateState.status === "up-to-date") {
    yield* electronDialog.showMessageBox({
      type: "info",
      title: t("update.menu.upToDate.title"),
      message: t("update.menu.upToDate.message", { version: updateState.currentVersion }),
      buttons: [t("common.ok")],
    });
  } else if (updateState.status === "error") {
    yield* electronDialog.showMessageBox({
      type: "warning",
      title: t("update.menu.checkFailed.title"),
      message: t("update.menu.checkFailed.message"),
      detail:
        updateState.message === null
          ? t("update.menu.unknownError")
          : formatDesktopUpdateMessage(updateState.message, t),
      buttons: [t("common.ok")],
    });
  }
});

const handleCheckForUpdatesMenuClick = Effect.fn("desktop.menu.handleCheckForUpdatesClick")(
  function* (getTranslate: () => MenuTranslate) {
    const updates = yield* DesktopUpdates.DesktopUpdates;
    const electronDialog = yield* ElectronDialog.ElectronDialog;
    const disabledReason = yield* updates.disabledReason;
    if (Option.isSome(disabledReason)) {
      const t = getTranslate();
      yield* logUpdaterInfo("manual update check requested, but updates are disabled", {
        disabledReason: disabledReason.value,
      });
      yield* electronDialog.showMessageBox({
        type: "info",
        title: t("update.menu.unavailable.title"),
        message: t("update.menu.unavailable.message"),
        detail: formatDesktopUpdateMessage(disabledReason.value, t),
        buttons: [t("common.ok")],
      });
      return;
    }

    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.ensureMain;
    yield* checkForUpdatesFromMenu(getTranslate);
  },
);

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const electronMenu = yield* ElectronMenu.ElectronMenu;
  const electronApp = yield* ElectronApp.ElectronApp;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const context = yield* Effect.context<DesktopApplicationMenuRuntimeServices>();
  const runPromise = Effect.runPromiseWith(context);
  const i18n = createI18n();
  let menuLanguage: SupportedLanguage | undefined;
  let currentTranslate = i18n.getFixedT("en");

  const runMenuEffect = <E>(
    action: string,
    effect: Effect.Effect<void, E, DesktopApplicationMenuRuntimeServices>,
  ) => {
    void runPromise(
      effect.pipe(
        Effect.annotateLogs({ action }),
        Effect.withSpan("desktop.menu.action"),
        Effect.catchCause((cause) => {
          const error = new DesktopApplicationMenuActionError({ action, cause });
          return logMenuError(error.message, { error });
        }),
      ),
    );
  };

  const syncLanguage = Effect.fn("desktop.menu.syncLanguage")(function* (settings: ClientSettings) {
    const systemLocale = yield* electronApp.systemLocale;
    const language = resolveLanguage(settings.languagePreference, [systemLocale]);
    if (language === menuLanguage) return;
    const t = i18n.getFixedT(language);
    const checkForUpdatesClick = () => {
      runMenuEffect(
        "check-for-updates",
        handleCheckForUpdatesMenuClick(() => currentTranslate),
      );
    };
    const settingsClick = () => {
      runMenuEffect("open-settings", dispatchMenuAction("open-settings"));
    };
    // Chromium already pastes as plain text for this chord, so the accelerator
    // needs nothing from the menu: the composer and the terminal each arm
    // themselves from the same keydown. Routing it through the renderer anyway
    // lands a second, injected paste and doubles the text. Only a menu click,
    // which produces no keystroke for them to see, needs that round trip.
    const pasteAsTextClick = (
      _item: Electron.MenuItem,
      _window: Electron.BaseWindow | undefined,
      event: Electron.KeyboardEvent,
    ) => {
      if (event.triggeredByAccelerator === true) return;
      runMenuEffect("paste-as-text", dispatchMenuAction("paste-as-text"));
    };
    const zoomClick = (direction: DesktopWindow.MainWindowZoomDirection) => () => {
      runMenuEffect(`zoom-${direction}`, zoomMainWindow(direction));
    };
    const mainContentsClick = (command: DesktopWindow.MainWindowContentsCommand) => () => {
      runMenuEffect(command, runMainContentsCommand(command));
    };
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (environment.platform === "darwin") {
      template.push({
        label: environment.displayName,
        submenu: [
          { role: "about", label: t("menu.about", { name: environment.displayName }) },
          {
            label: t("menu.checkForUpdates"),
            click: checkForUpdatesClick,
          },
          { type: "separator" },
          {
            label: t("menu.settings"),
            accelerator: "CmdOrCtrl+,",
            click: settingsClick,
          },
          { type: "separator" },
          { role: "services", label: t("menu.services") },
          { type: "separator" },
          { role: "hide", label: t("menu.hide", { name: environment.displayName }) },
          { role: "hideOthers", label: t("menu.hideOthers") },
          { role: "unhide", label: t("menu.showAll") },
          { type: "separator" },
          { role: "quit", label: t("menu.quitApp", { name: environment.displayName }) },
        ],
      });
    }

    template.push(
      {
        label: t("menu.file"),
        submenu: [
          ...(environment.platform === "darwin"
            ? []
            : [
                {
                  label: t("menu.settings"),
                  accelerator: "CmdOrCtrl+,",
                  click: settingsClick,
                },
                { type: "separator" as const },
              ]),
          environment.platform === "darwin"
            ? { role: "close", label: t("menu.closeWindow") }
            : {
                role: "quit",
                label: t(environment.platform === "win32" ? "menu.exit" : "menu.quit"),
              },
        ],
      },
      {
        label: t("menu.edit"),
        submenu: [
          { role: "undo", label: t("menu.undo") },
          { role: "redo", label: t("menu.redo") },
          { type: "separator" },
          { role: "cut", label: t("menu.cut") },
          { role: "copy", label: t("menu.copy") },
          { role: "paste", label: t("menu.paste") },
          {
            label: t("menu.pasteAsText"),
            accelerator: "CmdOrCtrl+Shift+V",
            click: pasteAsTextClick,
          },
          { role: "delete", label: t("menu.delete") },
          { type: "separator" },
          { role: "selectAll", label: t("menu.selectAll") },
          ...(environment.platform === "darwin"
            ? [
                { type: "separator" as const },
                {
                  label: t("menu.speech"),
                  submenu: [
                    { role: "startSpeaking" as const, label: t("menu.startSpeaking") },
                    { role: "stopSpeaking" as const, label: t("menu.stopSpeaking") },
                  ],
                },
              ]
            : []),
        ],
      },
      {
        label: t("menu.view"),
        submenu: [
          /*
            Not the reload, DevTools or zoom roles: those act on the focused
            webContents, so with a browser page focused they reload or zoom
            the guest page and the app UI appears stuck. These always target
            the main window (see DesktopWindow.zoomMain).
          */
          {
            label: t("menu.reload"),
            accelerator: "CmdOrCtrl+R",
            click: mainContentsClick("reload"),
          },
          {
            label: t("menu.forceReload"),
            accelerator: "Shift+CmdOrCtrl+R",
            click: mainContentsClick("forceReload"),
          },
          {
            label: t("menu.toggleDeveloperTools"),
            accelerator: environment.platform === "darwin" ? "Alt+Command+I" : "Ctrl+Shift+I",
            click: mainContentsClick("toggleDevTools"),
          },
          { type: "separator" },
          { label: t("menu.actualSize"), accelerator: "CmdOrCtrl+0", click: zoomClick("reset") },
          { label: t("menu.zoomIn"), accelerator: "CmdOrCtrl+=", click: zoomClick("in") },
          {
            label: t("menu.zoomIn"),
            accelerator: "CmdOrCtrl+Plus",
            visible: false,
            click: zoomClick("in"),
          },
          { label: t("menu.zoomOut"), accelerator: "CmdOrCtrl+-", click: zoomClick("out") },
          { type: "separator" },
          { role: "togglefullscreen", label: t("menu.toggleFullScreen") },
        ],
      },
      {
        role: "windowMenu",
        label: t("menu.window"),
        submenu: [
          { role: "minimize", label: t("menu.minimize") },
          { role: "zoom", label: t("menu.windowZoom") },
          ...(environment.platform === "darwin"
            ? [
                { type: "separator" as const },
                { role: "front" as const, label: t("menu.bringAllToFront") },
              ]
            : [{ role: "close" as const, label: t("menu.close") }]),
        ],
      },
      {
        role: "help",
        label: t("menu.help"),
        submenu: [
          {
            label: t("menu.checkForUpdates"),
            click: checkForUpdatesClick,
          },
        ],
      },
    );

    yield* electronMenu.setApplicationMenu(template);
    menuLanguage = language;
    currentTranslate = t;
  });

  const configure = Effect.gen(function* () {
    const settings = yield* clientSettings.get;
    yield* syncLanguage(Option.getOrElse(settings, () => DEFAULT_CLIENT_SETTINGS));
  }).pipe(Effect.withSpan("desktop.menu.configure"));

  return DesktopApplicationMenu.of({
    configure,
    syncLanguage,
  });
});

export const layer = Layer.effect(DesktopApplicationMenu, make);
