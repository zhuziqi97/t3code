// @effect-diagnostics nodeBuiltinImport:off - Render the installed builder's templates and run them only against a temporary filesystem with mocked system helpers.
import * as NodeChildProcess from "node:child_process";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HostProcess from "@t3tools/shared/HostProcess";

import { createBuildConfig } from "./build-desktop-artifact.ts";

const desktopRequire = NodeModule.createRequire(
  new URL("../apps/desktop/package.json", import.meta.url),
);
const builderRequire = NodeModule.createRequire(desktopRequire.resolve("electron-builder"));
const { AppInfo } = builderRequire("app-builder-lib/out/appInfo");
const { LinuxTargetHelper } = builderRequire("app-builder-lib/out/targets/LinuxTargetHelper");
const FpmTarget = builderRequire("app-builder-lib/out/targets/FpmTarget").default;

it.layer(NodeServices.layer)("Convene Linux packaging", (it) => {
  it.effect.each(["0.1.1-1", "0.2.0-nightly.20261022.1"])(
    "keeps installation targets stable for %s",
    (version) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-linux-install-" });
        const config = yield* createBuildConfig(
          "linux",
          "AppImage",
          version,
          false,
          false,
          undefined,
          undefined,
        );
        const linux = config.linux as Record<string, unknown>;
        const packager = {
          config,
          platformSpecificBuildOptions: linux,
          executableName: "t3code-convene",
          fileAssociations: [],
          projectDir: process.cwd(),
          appInfo: new AppInfo(
            { config, metadata: { name: "t3code-convene", version } },
            undefined,
            linux,
          ),
          info: {
            metadata: {},
            tempDirManager: {
              getTempFile: async ({ suffix }: { suffix: string }) => NodePath.join(root, suffix),
            },
          },
        };
        const helper = new LinuxTargetHelper(packager);
        const desktop = yield* Effect.promise(
          () => helper.computeDesktopEntry(linux) as Promise<string>,
        );
        assert.include(desktop, "Exec=/opt/t3code-convene/t3code-convene %U");
        assert.include(
          desktop,
          `Name=T3 Code for Convene (${version.includes("nightly") ? "Nightly" : "Beta"})`,
        );
        assert.include(desktop, "StartupWMClass=t3code-convene");
        assert.include(desktop, "x-scheme-handler/t3code-convene;");
        assert.include(desktop, "x-scheme-handler/t3code-convene-dev;");
        assert.equal(`${helper.getDesktopFileName()}.desktop`, "t3code-convene.desktop");
        assert.equal(packager.appInfo.sanitizedProductName, "t3code-convene");
        assert.equal(config.appId, "tech.ziqi.t3code-convene");
        assert.include(
          (config.deb as { fpm: string[] }).fpm[0],
          "=/opt/t3code-convene/resources/package-type",
        );

        const scripts = yield* Effect.promise(
          () =>
            new FpmTarget("deb", packager, helper, root).scriptFiles as Promise<{
              afterInstall: string;
              afterRemove: string;
              appArmor: string;
            }>,
        );
        const profile = yield* fs.readFileString(scripts.appArmor);
        assert.include(profile, 'profile "t3code-convene" "/opt/t3code-convene/t3code-convene"');
        const install = yield* fs.readFileString(scripts.afterInstall);
        const remove = yield* fs.readFileString(scripts.afterRemove);

        const platform = yield* HostProcess.Platform;
        if (platform !== "linux") return;
        const bin = NodePath.join(root, "bin");
        yield* fs.makeDirectory(bin);
        const log = NodePath.join(root, "commands");
        for (const command of [
          "update-alternatives",
          "update-mime-database",
          "update-desktop-database",
          "apparmor_status",
          "apparmor_parser",
          "unshare",
        ]) {
          const file = NodePath.join(bin, command);
          yield* fs.writeFileString(
            file,
            '#!/bin/sh\nprintf "%s" "${0##*/}" >> "$E_COMMAND_LOG"\nprintf " <%s>" "$@" >> "$E_COMMAND_LOG"\nprintf "\\n" >> "$E_COMMAND_LOG"\n[ "${0##*/}" != unshare ]\n',
          );
          yield* fs.chmod(file, 0o755);
        }
        for (const dir of ["opt/t3code-convene/resources", "usr/bin", "etc/apparmor.d"]) {
          yield* fs.makeDirectory(NodePath.join(root, dir), { recursive: true });
        }
        yield* fs.writeFileString(
          NodePath.join(root, "opt/t3code-convene/resources/apparmor-profile"),
          profile,
        );
        yield* fs.writeFileString(
          NodePath.join(root, "opt/t3code-convene/chrome-sandbox"),
          "fixture",
        );
        const run = (script: string) =>
          NodeChildProcess.execFileSync(
            "/bin/bash",
            [
              "-c",
              script
                .replaceAll("/opt/", `${root}/opt/`)
                .replaceAll("/usr/", `${root}/usr/`)
                .replaceAll("/etc/", `${root}/etc/`),
            ],
            {
              env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, E_COMMAND_LOG: log },
              stdio: "pipe",
            },
          );
        // Model the legacy removal targets; actual released postrm scripts need candidate upgrade tests.
        for (const stage of ["Alpha", "Beta"]) {
          run(remove.replaceAll("/opt/t3code-convene/", `/opt/T3 Code for Convene (${stage})/`));
        }
        run(install);
        const commands = yield* fs.readFileString(log);
        for (const stage of ["Alpha", "Beta"]) {
          assert.include(
            commands,
            `update-alternatives <--remove> <t3code-convene> <${root}/opt/T3 Code for Convene (${stage})/t3code-convene>`,
          );
        }
        assert.include(
          commands,
          `update-alternatives <--install> <${root}/usr/bin/t3code-convene> <t3code-convene> <${root}/opt/t3code-convene/t3code-convene> <100>`,
        );
        assert.equal(
          yield* fs.readFileString(NodePath.join(root, "etc/apparmor.d/t3code-convene")),
          profile,
        );
        run(remove);
        assert.isFalse(yield* fs.exists(NodePath.join(root, "etc/apparmor.d/t3code-convene")));
      }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })))),
  );
});
