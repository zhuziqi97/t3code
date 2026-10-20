import { describe, expect, it } from "@effect/vitest";
import { resolveConveneRelease } from "./conveneRelease.ts";

const runtimeInfo = {
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
} as const;
const current = {
  version: "0.1.0-convene.2",
  buildId: "local-build",
  baseUrl: "https://platform.example/prefix/",
  platform: "linux",
  runtimeInfo,
  packageType: "deb",
  appImage: false,
} as const;
const packages = [
  ["linux-x64", "other.AppImage"],
  ["windows-x64", "windows.exe"],
  ["macos-arm64", "mac.dmg"],
  ["linux-x64", "linux.deb"],
].map(([platform, name]) => ({
  platform: platform!,
  version_key: `versions/0.1.0-convene.10/release-build/${platform}/${name}`,
}));
const release = { version: "0.1.0-convene.10", build_id: "release-build", packages };

describe("Convene release selection", () => {
  it.each([
    ["linux", false, "deb", "x64", "/linux-x64/linux.deb"],
    ["linux", true, "deb", "x64", "/linux-x64/other.AppImage"],
    ["win32", false, null, "x64", "/windows-x64/windows.exe"],
    ["darwin", false, null, "arm64", "/macos-arm64/mac.dmg"],
  ] as const)(
    "selects the real package type on %s",
    (platform, appImage, packageType, hostArch, suffix) => {
      const result = resolveConveneRelease(release, {
        ...current,
        platform,
        appImage,
        packageType,
        runtimeInfo: { ...runtimeInfo, hostArch },
      });
      expect(result.relation).toBe("newer");
      expect(result.downloadUrl).toBe(
        `https://platform.example/prefix/downloads/file/versions/0.1.0-convene.10/release-build${suffix}`,
      );
      expect(result.downloadsUrl).toBe("https://platform.example/prefix/downloads/latest");
    },
  );

  it("compares semver numerically and does not order build identities", () => {
    expect(
      resolveConveneRelease({ ...release, version: "0.1.0-convene.1" }, current).relation,
    ).toBe("older");
    expect(resolveConveneRelease({ ...release, version: current.version }, current).relation).toBe(
      "different-build",
    );
    expect(
      resolveConveneRelease(
        { ...release, version: current.version, build_id: current.buildId },
        current,
      ).relation,
    ).toBe("same");
    expect(
      resolveConveneRelease(
        { ...release, version: `${current.version}+platform`, build_id: current.buildId },
        { ...current, version: `${current.version}+local` },
      ).relation,
    ).toBe("same");
    expect(
      resolveConveneRelease({ ...release, version: current.version }, { ...current, buildId: null })
        .relation,
    ).toBe("unknown-build");
  });

  it("does not borrow another architecture or installer when there is no match", () => {
    expect(
      resolveConveneRelease(
        { ...release, packages: packages.filter((p) => p.platform !== "linux-x64") },
        current,
      ).downloadUrl,
    ).toBeNull();
    expect(
      resolveConveneRelease(release, { ...current, packageType: null }).downloadUrl,
    ).toBeNull();
  });
});
