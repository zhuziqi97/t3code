import { formatDesktopUpdateMessage } from "@t3tools/client-runtime/i18n";
import { describe, expect, it } from "vite-plus/test";
import { i18n } from "../i18n";
import type { DesktopUpdateActionResult, DesktopUpdateState } from "@t3tools/contracts";

import {
  canCheckForUpdate,
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateDisabledReason,
  getDesktopUpdateIdleTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  getDesktopUpdateReleaseHistoryUrl,
  getDesktopUpdateReleaseUrl,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";

const baseState: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  channel: "latest",
  currentVersion: "1.0.0",
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

describe("desktop update button state", () => {
  it("opens only the paired platform download and never offers install for Convene", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "available",
      availableVersion: "1.1.0",
      downloadedVersion: "1.0.1",
      convene: {
        baseUrl: "https://platform.example/prefix",
        currentBuildId: "local",
        releaseVersion: "1.1.0",
        releaseBuildId: "release",
        relation: "newer",
        downloadUrl: "https://platform.example/prefix/downloads/file/versions/build/client.deb",
        downloadsUrl: "https://platform.example/prefix/downloads/latest",
        helpUrl: "https://platform.example/prefix/help/t3code",
      },
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("open-download");
    expect(resolveDesktopUpdateButtonAction({ ...state, status: "downloaded" })).toBe("none");
    expect(
      resolveDesktopUpdateButtonAction({
        ...state,
        convene: { ...state.convene!, downloadUrl: null },
      }),
    ).toBe("open-download");
    expect(getDesktopUpdateReleaseUrl("1.1.0", state)).toBe(state.convene?.helpUrl);
    expect(getDesktopUpdateReleaseHistoryUrl(state)).toBe(
      "https://platform.example/prefix/downloads/versions",
    );
    expect(
      getDesktopUpdateReleaseHistoryUrl({
        ...state,
        convene: { ...state.convene!, baseUrl: null },
      }),
    ).toBeNull();
  });

  it("shows a download action when an update is available", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "available",
      availableVersion: "1.1.0",
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
  });

  it("keeps retry action available after a download error", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "error",
      availableVersion: "1.1.0",
      message: "network timeout",
      errorContext: "download",
      canRetry: true,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
    expect(getDesktopUpdateButtonTooltip(state)).toContain("Click to retry");
  });

  it("says when the same version did not apply before", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "downloaded",
      availableVersion: "1.1.0",
      downloadedVersion: "1.1.0",
      notAppliedVersion: "1.1.0",
    };
    expect(getDesktopUpdateButtonTooltip(state)).toBe(
      "Update 1.1.0 did not apply. Click to retry.",
    );
    expect(
      getDesktopUpdateButtonTooltip({
        ...state,
        availableVersion: "1.2.0",
        downloadedVersion: "1.2.0",
      }),
    ).toContain("1.2.0 downloaded");
  });

  it("keeps install action available after an install error", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "error",
      downloadedVersion: "1.1.0",
      availableVersion: "1.1.0",
      message: "shutdown timeout",
      errorContext: "install",
      canRetry: true,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("install");
    expect(getDesktopUpdateButtonTooltip(state)).toContain("Click to retry");
  });

  it("keeps install action available after a background updater error", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "error",
      downloadedVersion: "1.1.0",
      availableVersion: "1.1.0",
      message: "background updater error",
      errorContext: null,
      canRetry: true,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("install");
    expect(getDesktopUpdateButtonTooltip(state)).toContain("Click to restart and install");
  });

  it("prefers a newly available release over a stale downloaded version", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "available",
      availableVersion: "1.2.0",
      downloadedVersion: "1.1.0",
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
  });

  it("hides the install action while checking for a newer release", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "checking",
      availableVersion: "1.1.0",
      downloadedVersion: "1.1.0",
      downloadPercent: 100,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("none");
  });

  it("has no action for non-actionable check errors", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "error",
      message: "network unavailable",
      errorContext: "check",
      canRetry: true,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("none");
  });

  it("disables the button while downloading", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "downloading",
      availableVersion: "1.1.0",
      downloadPercent: 42.5,
    };
    expect(isDesktopUpdateButtonDisabled(state)).toBe(true);
    expect(getDesktopUpdateButtonTooltip(state)).toContain("42%");
  });
});

describe("getDesktopUpdateActionError", () => {
  it("returns user-visible message for accepted failed attempts", () => {
    const result: DesktopUpdateActionResult = {
      accepted: true,
      completed: false,
      state: {
        ...baseState,
        status: "available",
        availableVersion: "1.1.0",
        message: "checksum mismatch",
        errorContext: "download",
        canRetry: true,
      },
    };
    expect(getDesktopUpdateActionError(result)).toBe("checksum mismatch");
  });

  it("ignores messages for non-accepted attempts", () => {
    const result: DesktopUpdateActionResult = {
      accepted: false,
      completed: false,
      state: {
        ...baseState,
        status: "error",
        message: "background failure",
        errorContext: "check",
        canRetry: false,
      },
    };
    expect(getDesktopUpdateActionError(result)).toBeNull();
  });

  it("ignores messages for successful attempts", () => {
    const result: DesktopUpdateActionResult = {
      accepted: true,
      completed: true,
      state: {
        ...baseState,
        status: "downloaded",
        downloadedVersion: "1.1.0",
        availableVersion: "1.1.0",
        message: null,
        errorContext: null,
        canRetry: true,
      },
    };
    expect(getDesktopUpdateActionError(result)).toBeNull();
  });
});

describe("desktop update UI helpers", () => {
  const t = i18n.getFixedT("en");
  it("builds the stable release URL for a downloaded version", () => {
    expect(getDesktopUpdateReleaseUrl("0.0.30", undefined, "pingdotgg/t3code")).toBe(
      "https://github.com/pingdotgg/t3code/releases/tag/v0.0.30",
    );
  });

  it("uses the configured desktop update repository for release URLs", () => {
    expect(getDesktopUpdateReleaseUrl("1.2.3", undefined, "JustYannicc/t3code")).toBe(
      "https://github.com/JustYannicc/t3code/releases/tag/v1.2.3",
    );
    expect(getDesktopUpdateReleaseHistoryUrl(undefined, "JustYannicc/t3code")).toBe(
      "https://github.com/JustYannicc/t3code/releases",
    );
  });

  it.each([
    "owner/repo/extra",
    "owner#notes/repo",
    "owner/repo#notes",
    "owner?tab=notes/repo",
    "owner/repo?tab=notes",
  ])("falls back to upstream for an invalid configured repository: %s", (repository) => {
    expect(getDesktopUpdateReleaseHistoryUrl(undefined, repository)).toBe(
      "https://github.com/pingdotgg/t3code/releases",
    );
    expect(getDesktopUpdateReleaseUrl("1.2.3", undefined, repository)).toBe(
      "https://github.com/pingdotgg/t3code/releases/tag/v1.2.3",
    );
  });

  it("builds the nightly release URL without dropping its version suffix", () => {
    expect(
      getDesktopUpdateReleaseUrl("0.0.30-nightly.20260728.931", undefined, "pingdotgg/t3code"),
    ).toBe("https://github.com/pingdotgg/t3code/releases/tag/v0.0.30-nightly.20260728.931");
  });

  it("omits the release URL when the updater does not report a version", () => {
    expect(getDesktopUpdateReleaseUrl(null)).toBeNull();
    expect(getDesktopUpdateReleaseUrl("  ")).toBeNull();
  });

  it("builds the release history URL", () => {
    expect(getDesktopUpdateReleaseHistoryUrl(undefined, "pingdotgg/t3code")).toBe(
      "https://github.com/pingdotgg/t3code/releases",
    );
  });

  it("toasts only for actionable updater errors", () => {
    expect(
      shouldToastDesktopUpdateActionResult({
        accepted: true,
        completed: false,
        state: { ...baseState, message: "checksum mismatch" },
      }),
    ).toBe(true);
    expect(
      shouldToastDesktopUpdateActionResult({
        accepted: true,
        completed: false,
        state: { ...baseState, message: null },
      }),
    ).toBe(false);
    expect(
      shouldToastDesktopUpdateActionResult({
        accepted: true,
        completed: true,
        state: { ...baseState, message: "checksum mismatch" },
      }),
    ).toBe(false);
  });

  it("shows an Apple Silicon warning for Intel builds under Rosetta", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      hostArch: "arm64",
      appArch: "x64",
      runningUnderArm64Translation: true,
    };

    expect(shouldShowArm64IntelBuildWarning(state)).toBe(true);
    expect(getArm64IntelBuildWarningDescription(state)).toContain("Apple Silicon");
    expect(getArm64IntelBuildWarningDescription(state)).toContain("Intel build");
  });

  it("changes the warning copy when a native build update is ready to download", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      hostArch: "arm64",
      appArch: "x64",
      runningUnderArm64Translation: true,
      status: "available",
      availableVersion: "1.1.0",
    };

    expect(getArm64IntelBuildWarningDescription(state)).toContain("Download the available update");
  });

  it("includes the downloaded version in the install confirmation copy", () => {
    expect(
      getDesktopUpdateInstallConfirmationMessage({
        availableVersion: "1.1.0",
        downloadedVersion: "1.1.1",
      }),
    ).toContain("Install update 1.1.1 and restart T3 Code?");
  });

  it("falls back to generic install confirmation copy when no version is available", () => {
    expect(
      getDesktopUpdateInstallConfirmationMessage({
        availableVersion: null,
        downloadedVersion: null,
      }),
    ).toContain("Install update and restart T3 Code?");
  });

  it("keeps the same install confirmation copy across desktop platforms", () => {
    expect(
      getDesktopUpdateInstallConfirmationMessage({
        availableVersion: "1.1.0",
        downloadedVersion: "1.1.0",
      }),
    ).toBe(
      "Install update 1.1.0 and restart T3 Code?\n\nAny running tasks will be interrupted. Make sure you're ready before continuing.",
    );
  });
});

describe("canCheckForUpdate", () => {
  it("returns false for null state", () => {
    expect(canCheckForUpdate(null)).toBe(false);
  });

  it("returns false when updates are disabled", () => {
    expect(canCheckForUpdate({ ...baseState, enabled: false, status: "disabled" })).toBe(false);
  });

  it("returns false while checking", () => {
    expect(canCheckForUpdate({ ...baseState, status: "checking" })).toBe(false);
  });

  it("returns false while downloading", () => {
    expect(canCheckForUpdate({ ...baseState, status: "downloading", downloadPercent: 50 })).toBe(
      false,
    );
  });

  it("returns true once an update has been downloaded so newer releases can be found", () => {
    expect(
      canCheckForUpdate({
        ...baseState,
        status: "downloaded",
        availableVersion: "1.1.0",
        downloadedVersion: "1.1.0",
      }),
    ).toBe(true);
  });

  it("returns true when idle", () => {
    expect(canCheckForUpdate({ ...baseState, status: "idle" })).toBe(true);
  });

  it("returns true when up-to-date", () => {
    expect(canCheckForUpdate({ ...baseState, status: "up-to-date" })).toBe(true);
  });

  it("returns true when an update is available", () => {
    expect(
      canCheckForUpdate({ ...baseState, status: "available", availableVersion: "1.1.0" }),
    ).toBe(true);
  });

  it("returns true on error so the user can retry", () => {
    expect(
      canCheckForUpdate({
        ...baseState,
        status: "error",
        errorContext: "check",
        message: "network",
      }),
    ).toBe(true);
  });
});

describe("getDesktopUpdateButtonTooltip", () => {
  it("returns 'Up to date' for non-actionable states", () => {
    expect(getDesktopUpdateButtonTooltip({ ...baseState, status: "idle" })).toBe("Up to date");
    expect(getDesktopUpdateButtonTooltip({ ...baseState, status: "up-to-date" })).toBe(
      "Up to date",
    );
  });
});

describe("disabled update reason", () => {
  const disabledState: DesktopUpdateState = {
    ...baseState,
    enabled: false,
    status: "disabled",
    message: "Automatic updates are only available in packaged production builds.",
  };

  it("explains why checking is unavailable", () => {
    expect(getDesktopUpdateDisabledReason(disabledState)).toBe(
      "Automatic updates are only available in packaged production builds.",
    );
    expect(getDesktopUpdateIdleTooltip(disabledState)).toEqual({
      title: "Updates unavailable",
      detail: "Automatic updates are only available in packaged production builds.",
    });
    expect(getDesktopUpdateDisabledReason({ ...disabledState, message: null })).toBe(
      "Automatic updates are not available in this build.",
    );
  });

  it("keeps the check prompt when updates are available", () => {
    expect(getDesktopUpdateDisabledReason(baseState)).toBeNull();
    expect(getDesktopUpdateDisabledReason(null)).toBeNull();
    expect(getDesktopUpdateIdleTooltip(baseState)).toEqual({
      title: "Check for updates",
      detail: null,
    });
  });
});

it("formats native T3 disabled reasons and preserves arbitrary updater diagnostics", () => {
  const t = i18n.getFixedT("zh");
  expect(
    formatDesktopUpdateMessage(
      "Automatic updates are not available because no update feed is configured.",
      t,
    ),
  ).toBe("未配置更新源，无法自动更新。");
  expect(
    formatDesktopUpdateMessage(
      "Automatic updates are only available in packaged production builds.",
      t,
    ),
  ).toBe("仅打包后的正式构建支持自动更新。");
  expect(
    formatDesktopUpdateMessage(
      "Automatic updates are disabled by the T3CODE_DISABLE_AUTO_UPDATE setting.",
      t,
    ),
  ).toBe("T3CODE_DISABLE_AUTO_UPDATE 设置已禁用自动更新。");
  expect(
    formatDesktopUpdateMessage(
      "Automatic updates on Linux require the AppImage or the .deb package.",
      t,
    ),
  ).toBe("Linux 自动更新需要使用 AppImage 或 .deb 软件包。");
  expect(formatDesktopUpdateMessage("Network download error /tmp/原文 404", t)).toBe(
    "Network download error /tmp/原文 404",
  );
  expect(formatDesktopUpdateMessage("", t)).toBe("");
});

it("formats the exact channel and action templates emitted by the desktop updater", () => {
  const t = i18n.getFixedT("zh");
  expect(
    formatDesktopUpdateMessage(
      "Cannot change the desktop update channel to nightly while an update download action is in progress.",
      t,
    ),
  ).toBe("正在执行更新下载操作，无法将桌面更新通道切换为 nightly。");
  expect(
    formatDesktopUpdateMessage("Failed to persist the latest desktop update channel.", t),
  ).toBe("无法保存桌面更新通道 latest。");
  expect(
    formatDesktopUpdateMessage("Desktop updater background operation reported an error.", t),
  ).toBe("桌面更新程序的后台操作报告了错误。");
  expect(formatDesktopUpdateMessage("Desktop update install action failed unexpectedly.", t)).toBe(
    "桌面更新的安装操作意外失败。",
  );
});
