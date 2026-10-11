import type { TFunction } from "i18next";
import type { MessageKey } from "@t3tools/client-runtime/i18n";

// Only translate messages produced by our host checks. CLI/network diagnostics stay verbatim.
const messages: Readonly<Record<string, MessageKey>> = {
  "Installing device hub…": "device.hub.installing",
  "Installing agent tools…": "device.agent.installing",
  "Environment disconnected": "device.message.offline",
  "This connection cannot test device hosts.": "device.message.test-denied",
  "iOS Simulators need macOS with Xcode.": "device.message.ios-macos",
  "Xcode command line tools were not found.": "device.message.xcode-missing",
  "Android SDK was not found. Install it with Android Studio or set ANDROID_HOME to your SDK directory.":
    "device.message.android-sdk",
  "iOS needs macOS with Xcode and working xcrun simctl.": "device.message.ios-ssh",
  "Android SDK missing. Set ANDROID_HOME or put adb on the SSH PATH.": "device.message.android-ssh",
  "Cannot reach device host. Test its SSH connection in Settings.": "device.message.unreachable",
  "Reconnecting to device host…": "device.message.reconnecting",
};
const sdkMessages = [
  [
    "Android SDK Platform-Tools are missing from ",
    ". Install them in Android Studio's SDK Manager.",
    "device.message.platform-tools",
  ],
  [
    "Android Emulator is missing from ",
    ". Install it in Android Studio's SDK Manager.",
    "device.message.emulator",
  ],
  [
    "Android SDK Command-line Tools (latest) are missing from ",
    ". Install them in Android Studio's SDK Manager.",
    "device.message.command-tools",
  ],
  [
    "The Android SDK command-line tools in ",
    " appear to be an older, unsupported version. Install Android SDK Command-line Tools (latest) in Android Studio's SDK Manager under SDK Tools.",
    "device.message.old-command-tools",
  ],
] as const;

export function formatDeviceMessage(message: string, t: TFunction): string {
  const key = messages[message];
  if (key) return t(key);
  for (const [prefix, suffix, template] of sdkMessages) {
    if (message.startsWith(prefix) && message.endsWith(suffix)) {
      return t(template, { path: message.slice(prefix.length, -suffix.length) });
    }
  }
  const installing = /^Installing (device hub|agent tools) (.+)…$/.exec(message);
  if (installing)
    return t(
      installing[1] === "device hub"
        ? "device.progress.hub-install"
        : "device.progress.agent-install",
      { version: installing[2] },
    );
  const updating = /^Updating (device hub|agent tools) from (.+) to (.+)…$/.exec(message);
  if (updating)
    return t(
      updating[1] === "device hub" ? "device.progress.hub-update" : "device.progress.agent-update",
      { from: updating[2], to: updating[3] },
    );
  return message;
}
