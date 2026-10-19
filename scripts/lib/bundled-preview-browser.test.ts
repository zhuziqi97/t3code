import * as NodeServices from "@effect/platform-node/NodeServices";
import { extractFile } from "@electron/asar";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { bundledBrowserPlatforms } from "./bundled-preview-browser.ts";
import { packWindowsServerAsar } from "../build-desktop-artifact.ts";

it.each([
  ["linux", "x64", ["linux64"]],
  ["linux", "arm64", ["linux-arm64"]],
  ["mac", "x64", ["mac-x64"]],
  ["mac", "arm64", ["mac-arm64"]],
  ["mac", "universal", ["mac-x64", "mac-arm64"]],
  ["win", "x64", ["win64"]],
  ["win", "arm64", ["win64"]],
] as const)("ships the browser for %s %s", (platform, arch, expected) => {
  expect(bundledBrowserPlatforms(platform, arch).map((release) => release.platform)).toEqual(
    expected,
  );
});
it.layer(NodeServices.layer)("bundled browser resources", (it) => {
  it.effect("retains native Windows and WSL browser archives inside the real server sidecar", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-browser-asar-" });
      const sourceDir = path.join(root, "server");
      const releases = [
        ...bundledBrowserPlatforms("win", "arm64"),
        ...bundledBrowserPlatforms("linux", "arm64"),
      ];
      for (const release of releases) {
        const file = path.join(
          sourceDir,
          "apps/server/dist/browser",
          release.version,
          `${release.platform}.zip`,
        );
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, `browser-${release.platform}`);
      }
      yield* fs.makeDirectory(path.join(sourceDir, "node_modules/native"), { recursive: true });
      yield* fs.writeFileString(path.join(sourceDir, "node_modules/native/addon.node"), "MZ");
      const archive = path.join(root, "server.asar");
      yield* packWindowsServerAsar({ sourceDir, asarPath: archive, arch: "arm64" });
      for (const release of releases) {
        expect(
          extractFile(
            archive,
            `apps/server/dist/browser/${release.version}/${release.platform}.zip`,
          ).toString(),
        ).toBe(`browser-${release.platform}`);
      }
    }).pipe(Effect.scoped),
  );
});
