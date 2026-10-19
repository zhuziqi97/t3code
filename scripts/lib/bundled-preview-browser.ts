import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  downloadPreviewBrowserArchive,
  previewBrowserRelease,
} from "@t3tools/shared/previewBrowserArchive";

/** Archives stay readable in app.asar and are installed by the existing runtime owner. */
export function bundledBrowserPlatforms(
  platform: "mac" | "linux" | "win",
  arch: "x64" | "arm64" | "universal",
) {
  const host = platform === "mac" ? "darwin" : platform === "win" ? "win32" : "linux";
  const architectures = arch === "universal" ? (["x64", "arm64"] as const) : [arch];
  return [...new Set(architectures.map((cpu) => previewBrowserRelease(host, cpu)))].flatMap(
    (release) => (release ? [release] : []),
  );
}

export const stagePreviewBrowserArchives = Effect.fn("stagePreviewBrowserArchives")(
  function* (input: {
    readonly destination: string;
    readonly platform: "mac" | "linux" | "win";
    readonly arch: "x64" | "arm64" | "universal";
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    for (const release of bundledBrowserPlatforms(input.platform, input.arch)) {
      const directory = path.join(input.destination, release.version);
      yield* fs.makeDirectory(directory, { recursive: true });
      const archivePath = path.join(directory, `${release.platform}.zip`);
      yield* Effect.log(`[browser] Staging ${release.platform} ${release.version}`);
      yield* downloadPreviewBrowserArchive({ release, archivePath });
    }
  },
);
