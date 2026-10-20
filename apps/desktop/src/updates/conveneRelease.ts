import type { ConveneDesktopUpdate, DesktopRuntimeInfo } from "@t3tools/contracts";
import { compareSemverVersions, parseSemver } from "@t3tools/shared/semver";
import * as Schema from "effect/Schema";

export const ConveneRelease = Schema.Struct({
  version: Schema.NonEmptyString,
  build_id: Schema.NonEmptyString,
  packages: Schema.Array(
    Schema.Struct({
      platform: Schema.String,
      version_key: Schema.NonEmptyString,
    }),
  ),
});

/** Use the same prefix-preserving rule as Convene's API connection. */
export const conveneUrl = (baseUrl: string, path: string) =>
  `${baseUrl.replace(/\/$/, "")}/${path}`;

export function resolveConveneRelease(
  release: typeof ConveneRelease.Type,
  current: {
    readonly version: string;
    readonly buildId: string | null;
    readonly baseUrl: string;
    readonly platform: NodeJS.Platform;
    readonly runtimeInfo: DesktopRuntimeInfo;
    readonly packageType: string | null;
    readonly appImage: boolean;
  },
): ConveneDesktopUpdate {
  const releaseVersion = release.version.split("+", 1)[0] ?? release.version;
  const currentVersion = current.version.split("+", 1)[0] ?? current.version;
  if (!parseSemver(releaseVersion) || !parseSemver(currentVersion)) {
    throw new Error("The release version is not a semantic version.");
  }
  const comparison = compareSemverVersions(releaseVersion, currentVersion);
  const relation =
    comparison > 0
      ? "newer"
      : comparison < 0
        ? "older"
        : current.buildId === null
          ? "unknown-build"
          : release.build_id !== current.buildId
            ? "different-build"
            : "same";
  const arch =
    current.platform === "darwin" && current.runtimeInfo.hostArch === "arm64"
      ? "arm64"
      : current.runtimeInfo.appArch;
  const platform =
    current.platform === "darwin"
      ? `macos-${arch}`
      : current.platform === "win32"
        ? `windows-${arch}`
        : `${current.platform}-${arch}`;
  const extension =
    current.platform === "linux"
      ? current.appImage
        ? ".AppImage"
        : current.packageType === "deb"
          ? ".deb"
          : null
      : current.platform === "win32"
        ? ".exe"
        : current.platform === "darwin"
          ? ".dmg"
          : null;
  const item =
    extension === null
      ? undefined
      : release.packages.find(
          (item) => item.platform === platform && item.version_key.endsWith(extension),
        );
  return {
    baseUrl: current.baseUrl,
    currentBuildId: current.buildId,
    releaseVersion: release.version,
    releaseBuildId: release.build_id,
    relation,
    // Pin the result to this release, rather than a mutable latest object.
    downloadUrl: item ? conveneUrl(current.baseUrl, `downloads/file/${item.version_key}`) : null,
    downloadsUrl: conveneUrl(current.baseUrl, "downloads/latest"),
    helpUrl: conveneUrl(current.baseUrl, "help/t3code"),
  };
}
