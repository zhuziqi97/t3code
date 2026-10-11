import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_CLIENT_SETTINGS,
  type ClientSettings,
  type DesktopUpdateState,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import { setClientSettings } from "../ipc/methods/clientSettings.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopSnapShot from "../snapShot/DesktopSnapShot.ts";
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import * as DesktopApplicationMenu from "./DesktopApplicationMenu.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

type MenuTemplate = readonly Electron.MenuItemConstructorOptions[];

const baseUpdateState: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  channel: "latest",
  currentVersion: "1.2.3-nightly.20261010",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};

const englishSettings = { ...DEFAULT_CLIENT_SETTINGS, languagePreference: "en" as const };
const chineseSettings = { ...DEFAULT_CLIENT_SETTINGS, languagePreference: "zh" as const };

function submenu(template: MenuTemplate, label: string) {
  const item = template.find((item) => item.label === label);
  if (!Array.isArray(item?.submenu)) throw new Error(`Missing submenu: ${label}`);
  return item.submenu;
}

function click(item: Electron.MenuItemConstructorOptions | undefined) {
  if (typeof item?.click !== "function") throw new Error("Missing menu action");
  item.click({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
}

function layerMenu(input: {
  readonly templates: MenuTemplate[];
  readonly initialSettings?: ClientSettings;
  readonly systemLocale?: string;
  readonly platform?: "linux" | "darwin" | "win32";
  readonly settings?: DesktopClientSettings.DesktopClientSettings["Service"];
  readonly snapShots?: ClientSettings[];
  readonly selectedAction?: Deferred.Deferred<string>;
  readonly dialog?: Deferred.Deferred<Electron.MessageBoxOptions>;
  readonly disabledReason?: string;
  readonly check?: DesktopUpdates.DesktopUpdates["Service"]["check"];
}) {
  const dependencies = Layer.mergeAll(
    input.settings
      ? Layer.succeed(DesktopClientSettings.DesktopClientSettings, input.settings)
      : DesktopClientSettings.layerTest(Option.fromNullishOr(input.initialSettings)),
    DesktopEnvironment.layer({
      dirname: "/repo/apps/desktop/dist-electron",
      homeDirectory: "/Users/alice",
      platform: input.platform ?? "linux",
      processArch: "x64",
      appVersion: "1.2.3-nightly.20261010.17",
      appPath: "/repo",
      isPackaged: true,
      resourcesPath: "/repo/resources",
      runningUnderArm64Translation: false,
    }).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({})))),
    Layer.mock(ElectronApp.ElectronApp)({
      systemLocale: Effect.succeed(input.systemLocale ?? "en-US"),
    }),
    Layer.mock(ElectronMenu.ElectronMenu)({
      setApplicationMenu: (template) =>
        Effect.sync(() => {
          input.templates.push(template);
        }),
    }),
    Layer.mock(DesktopWindow.DesktopWindow)({
      ensureMain: Effect.succeed({} as Electron.BrowserWindow),
      dispatchMenuAction: (action) =>
        input.selectedAction
          ? Deferred.succeed(input.selectedAction, action).pipe(Effect.asVoid)
          : Effect.die("unexpected menu action"),
    }),
    Layer.mock(DesktopUpdates.DesktopUpdates)({
      disabledReason: Effect.succeed(Option.fromNullishOr(input.disabledReason)),
      check: input.check ?? (() => Effect.die("unexpected update check")),
    }),
    Layer.mock(ElectronDialog.ElectronDialog)({
      showMessageBox: (options) =>
        input.dialog
          ? Deferred.succeed(input.dialog, options).pipe(
              Effect.as({ response: 0, checkboxChecked: false }),
            )
          : Effect.die("unexpected dialog"),
    }),
    Layer.mock(DesktopSnapShot.DesktopSnapShot)({
      configure: (settings) =>
        Effect.sync(() => {
          input.snapShots?.push(settings);
        }),
    }),
  );
  return DesktopApplicationMenu.layer.pipe(Layer.provideMerge(dependencies));
}

describe("DesktopApplicationMenu language preference", () => {
  it.effect(
    "starts in the system language and keeps macOS roles, branding and Settings action",
    () => {
      const templates: MenuTemplate[] = [];
      return Effect.gen(function* () {
        const selectedAction = yield* Deferred.make<string>();
        yield* Effect.gen(function* () {
          const menu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
          yield* menu.configure;
          const template = templates[0]!;
          assert.deepEqual(
            template.map((item) => item.label),
            ["T3 Code (Nightly)", "文件", "编辑", "视图", "窗口", "帮助"],
          );
          const application = submenu(template, "T3 Code (Nightly)");
          assert.equal(
            application.find((item) => item.role === "about")?.label,
            "关于 T3 Code (Nightly)",
          );
          assert.equal(
            application.find((item) => item.role === "hide")?.label,
            "隐藏 T3 Code (Nightly)",
          );
          assert.equal(
            application.find((item) => item.role === "quit")?.label,
            "退出 T3 Code (Nightly)",
          );
          assert.equal(template.find((item) => item.label === "窗口")?.role, "windowMenu");
          assert.deepEqual(
            submenu(template, "窗口")
              .filter((item) => item.role)
              .map((item) => item.role),
            ["minimize", "zoom", "front"],
          );
          assert.equal(submenu(template, "文件")[0]?.role, "close");
          const settings = application.find((item) => item.label === "设置…");
          assert.equal(settings?.accelerator, "CmdOrCtrl+,");
          click(settings);
          assert.equal(yield* Deferred.await(selectedAction), "open-settings");
        }).pipe(
          Effect.provide(
            layerMenu({
              templates,
              selectedAction,
              platform: "darwin",
              systemLocale: "zh-Hans-CN",
            }),
          ),
        );
      });
    },
  );

  it.effect(
    "persists language changes through settings IPC and rebuilds only for a different display language",
    () => {
      const templates: MenuTemplate[] = [];
      const snapShots: ClientSettings[] = [];
      return Effect.gen(function* () {
        const menu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
        const settings = yield* DesktopClientSettings.DesktopClientSettings;
        yield* menu.configure;
        assert.equal(templates[0]?.[0]?.label, "File");
        yield* setClientSettings.handler(chineseSettings);
        assert.equal(Option.getOrNull(yield* settings.get)?.languagePreference, "zh");
        assert.equal(templates[1]?.[0]?.label, "文件");
        yield* setClientSettings.handler(chineseSettings);
        assert.lengthOf(templates, 2);
        yield* setClientSettings.handler(englishSettings);
        assert.equal(templates[2]?.[0]?.label, "File");
        assert.equal(
          submenu(templates[2]!, "File").find((item) => item.role === "quit")?.label,
          "Exit",
        );
        assert.equal(Option.getOrNull(yield* settings.get)?.languagePreference, "en");
        assert.deepEqual(snapShots, [chineseSettings, chineseSettings, englishSettings]);
      }).pipe(
        Effect.provide(
          layerMenu({
            templates,
            snapShots,
            initialSettings: englishSettings,
            systemLocale: "zh-CN",
            platform: "win32",
          }),
        ),
      );
    },
  );

  it.effect("keeps the displayed menu when saving the language preference fails", () => {
    const templates: MenuTemplate[] = [];
    const snapShots: ClientSettings[] = [];
    const failure = new DesktopClientSettings.DesktopClientSettingsWriteError({
      operation: "write-temporary-file",
      path: "/isolated/client-settings.json",
      cause: new Error("disk full"),
    });
    return Effect.gen(function* () {
      const menu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
      yield* menu.configure;
      const result = yield* Effect.exit(setClientSettings.handler(chineseSettings));
      assert.isTrue(Exit.isFailure(result));
      assert.lengthOf(templates, 1);
      assert.equal(templates[0]?.[0]?.label, "File");
      assert.isEmpty(snapShots);
    }).pipe(
      Effect.provide(
        layerMenu({
          templates,
          snapShots,
          settings: {
            get: Effect.succeedSome(englishSettings),
            set: () => Effect.fail(failure),
          },
        }),
      ),
    );
  });

  it.effect.each([
    { ...baseUpdateState, status: "up-to-date" as const },
    { ...baseUpdateState, status: "error" as const, message: "Network error /tmp/原文 404" },
    { ...baseUpdateState, status: "error" as const },
  ])("uses the current language after an update check finishes ($status, $message)", (state) => {
    const templates: MenuTemplate[] = [];
    return Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const dialog = yield* Deferred.make<Electron.MessageBoxOptions>();
      yield* Effect.gen(function* () {
        const menu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
        yield* menu.configure;
        click(submenu(templates[0]!, "Help")[0]);
        yield* Deferred.await(started);
        yield* setClientSettings.handler(chineseSettings);
        yield* Deferred.succeed(finish, undefined);
        const options = yield* Deferred.await(dialog);
        assert.deepEqual(options.buttons, ["确定"]);
        if (state.status === "up-to-date") {
          assert.equal(options.title, "已是最新版本");
          assert.equal(options.message, "T3 Code 1.2.3-nightly.20261010 已是当前可用的最新版本。");
        } else {
          assert.equal(options.title, "检查更新失败");
          assert.equal(options.message, "无法检查更新。");
          assert.equal(options.detail, state.message ?? "发生未知错误，请稍后重试。");
        }
      }).pipe(
        Effect.provide(
          layerMenu({
            templates,
            dialog,
            initialSettings: englishSettings,
            check: () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(finish);
                return { checked: true, state };
              }),
          }),
        ),
      );
    });
  });

  it.effect("shows a translated disabled reason without starting an update check", () => {
    const templates: MenuTemplate[] = [];
    return Effect.gen(function* () {
      const dialog = yield* Deferred.make<Electron.MessageBoxOptions>();
      yield* Effect.gen(function* () {
        const menu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
        yield* menu.configure;
        click(submenu(templates[0]!, "帮助")[0]);
        const options = yield* Deferred.await(dialog);
        assert.equal(options.title, "无法更新");
        assert.equal(options.message, "当前无法自动更新。");
        assert.equal(options.detail, "仅打包后的正式构建支持自动更新。");
        assert.deepEqual(options.buttons, ["确定"]);
      }).pipe(
        Effect.provide(
          layerMenu({
            templates,
            dialog,
            initialSettings: chineseSettings,
            disabledReason: "Automatic updates are only available in packaged production builds.",
          }),
        ),
      );
    });
  });
});
import * as NodeServices from "@effect/platform-node/NodeServices";
