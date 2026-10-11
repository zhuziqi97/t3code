import { expect, it } from "vite-plus/test";
import { i18n } from "../../i18n";
import { formatDeviceMessage } from "./deviceMessages";
import { platformSetupStatus } from "./DeviceSetup";
import { deviceToolInstallMessage, type DeviceServiceState } from "@t3tools/contracts";

it("translates current host guidance while preserving SDK paths and unrecognized diagnostics", () => {
  const t = i18n.getFixedT("zh");
  expect(formatDeviceMessage("iOS Simulators need macOS with Xcode.", t)).toBe(
    "iOS 模拟器需要安装 Xcode 的 macOS。",
  );
  const path = "/Users/Raw Name/Android/Sdk";
  expect(
    formatDeviceMessage(
      `Android Emulator is missing from ${path}. Install it in Android Studio's SDK Manager.`,
      t,
    ),
  ).toBe(`${path} 中缺少 Android 模拟器，请在 Android Studio 的 SDK Manager 中安装。`);
  expect(formatDeviceMessage("SSH: Permission denied (publickey) Raw Host", t)).toBe(
    "SSH: Permission denied (publickey) Raw Host",
  );
  const state = { hosts: [], devices: [], hostStatus: "ready" } as unknown as DeviceServiceState;
  expect(platformSetupStatus(state, "android", t)).toEqual({
    ready: false,
    message: "未检测到 Android 支持。",
  });
  const withHosts: DeviceServiceState = {
    ...state,
    hosts: [
      {
        id: "native",
        kind: "local",
        label: "Raw",
        hubInstalled: false,
        agentDeviceInstalled: false,
        platforms: [
          { platform: "ios", available: true },
          { platform: "android", available: false, reason: "Custom raw diagnostic" },
        ],
      },
    ],
  };
  expect(platformSetupStatus(withHosts, "ios", t).message).toContain("Xcode 设置 → 组件");
  expect(platformSetupStatus(withHosts, "android", t)).toEqual({
    ready: false,
    message: "Custom raw diagnostic",
  });
});

it("translates real install and update progress without changing package versions", () => {
  const t = i18n.getFixedT("zh");
  expect(formatDeviceMessage(deviceToolInstallMessage("device hub", undefined), t)).toBe(
    "正在安装设备中心…",
  );
  expect(
    formatDeviceMessage(
      deviceToolInstallMessage("device hub", {
        requiredVersion: "0.11.0",
        installedVersions: ["0.9.0", "0.10.0"],
        runningVersion: null,
      }),
      t,
    ),
  ).toBe("正在将设备中心从 0.10.0 更新至 0.11.0…");
  expect(
    formatDeviceMessage(
      deviceToolInstallMessage("agent tools", {
        requiredVersion: "9.0.0-beta.1",
        installedVersions: [],
        runningVersion: null,
      }),
      t,
    ),
  ).toBe("正在安装智能体工具 9.0.0-beta.1…");
});
