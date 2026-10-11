import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { createI18n } from "@t3tools/client-runtime/i18n";
import {
  getProviderStatusBannerKey,
  getProviderStatusMessage,
  shouldShowProviderStatusBanner,
} from "./ProviderStatusBanner";

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex-work"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-09-22T00:00:00Z",
  models: [],
  skills: [],
  slashCommands: [],
  compatibilityAdvisory: {
    status: "unsupported",
    message: "Unsupported version. Use 2.0.0.",
    recommendedVersion: "2.0.0",
    recommendedRange: null,
  },
};

describe("compatibility banners", () => {
  it.each([
    [
      "opencode",
      "Couldn't reach the configured OpenCode server at http://127.0.0.1:4096/原文. Check that the server is running and the URL is correct.",
      "无法连接已配置的 OpenCode 服务端 http://127.0.0.1:4096/原文。请检查服务端是否正在运行，以及 URL 是否正确。",
    ],
    [
      "pi",
      "Pi launch argument '--mode' is controlled by T3 Code and cannot be overridden.",
      "Pi 启动参数 '--mode' 由 T3 Code 管理，不能覆盖。",
    ],
    [
      "cursor",
      "Cursor SDK catalog request timed out after 15000ms.",
      "Cursor SDK 模型目录请求在 15000 毫秒后超时。",
    ],
  ])("retranslates %s guidance without changing dismissal identity", (driver, message, chinese) => {
    const status: ServerProvider = {
      ...provider,
      driver: ProviderDriverKind.make(driver),
      status: "error",
      auth: { status: "unknown" },
      compatibilityAdvisory: {
        status: "supported",
        message: null,
        recommendedVersion: null,
        recommendedRange: null,
      },
      message,
    };
    const key = getProviderStatusBannerKey(status);
    expect(shouldShowProviderStatusBanner(status, null)).toBe(true);
    expect(getProviderStatusMessage(status, createI18n({ lng: "zh" }).t)).toBe(chinese);
    expect(getProviderStatusMessage(status, createI18n({ lng: "en" }).t)).toBe(message);
    expect(getProviderStatusBannerKey(status)).toBe(key);
    expect(shouldShowProviderStatusBanner(status, key)).toBe(false);
    expect(status.message).toBe(message);
  });

  it("shows and dismisses a warning on a healthy provider, then clears it after policy relaxation", () => {
    expect(shouldShowProviderStatusBanner(provider, null)).toBe(true);
    expect(shouldShowProviderStatusBanner(provider, getProviderStatusBannerKey(provider))).toBe(
      false,
    );
    expect(
      shouldShowProviderStatusBanner(
        { ...provider, version: "1.0.1" },
        getProviderStatusBannerKey(provider),
      ),
    ).toBe(true);
    const relaxed: ServerProvider = {
      ...provider,
      compatibilityAdvisory: {
        ...provider.compatibilityAdvisory!,
        status: "supported",
        message: null,
      },
    };
    expect(getProviderStatusBannerKey(relaxed)).toBeNull();
    expect(getProviderStatusBannerKey({ ...provider, status: "disabled" })).toBeNull();
    expect(
      getProviderStatusBannerKey({
        ...provider,
        compatibilityAdvisory: { ...provider.compatibilityAdvisory!, status: "graceful" },
      }),
    ).toBeNull();
  });

  it("shows downgrade guidance instead of a broken OpenCode inventory timeout", () => {
    const message = "This provider version is known to be incompatible. Use 1.14.19.";
    const broken: ServerProvider = {
      ...provider,
      driver: ProviderDriverKind.make("opencode"),
      version: "2.0.3",
      status: "error",
      auth: { status: "unknown" },
      message: "Failed to load OpenCode provider inventory: Timed out waiting for server start.",
      compatibilityAdvisory: {
        status: "broken",
        message,
        recommendedVersion: "1.14.19",
        recommendedRange: ">=1.14.19 <2.0.0",
      },
    };
    expect(shouldShowProviderStatusBanner(broken, null)).toBe(true);
    const timeoutOnly: ServerProvider = {
      ...broken,
      compatibilityAdvisory: {
        ...broken.compatibilityAdvisory!,
        status: "supported",
        message: null,
      },
    };
    expect(shouldShowProviderStatusBanner(broken, getProviderStatusBannerKey(timeoutOnly))).toBe(
      true,
    );
    expect(shouldShowProviderStatusBanner(broken, getProviderStatusBannerKey(broken))).toBe(false);
    expect(
      shouldShowProviderStatusBanner(
        {
          ...broken,
          compatibilityAdvisory: { ...broken.compatibilityAdvisory!, message: "Use 1.14.20." },
        },
        getProviderStatusBannerKey(broken),
      ),
    ).toBe(true);
    expect(getProviderStatusMessage(broken)).toBe(message);
    expect(
      getProviderStatusMessage({
        ...broken,
        compatibilityAdvisory: {
          ...broken.compatibilityAdvisory!,
          status: "supported",
          message: null,
        },
      }),
    ).toBe(broken.message);
    expect(getProviderStatusMessage({ ...broken, auth: { status: "unauthenticated" } })).toBe(
      broken.message,
    );
  });

  it("keeps authentication failures ahead of compatibility warnings even without a probe message", () => {
    const unauthenticated: ServerProvider = {
      ...provider,
      status: "error",
      auth: { status: "unauthenticated" },
    };
    expect(getProviderStatusMessage(unauthenticated)).toBe(
      "Sign in via the CLI to authenticate again.",
    );
    expect(getProviderStatusMessage({ ...unauthenticated, message: "Credentials expired" })).toBe(
      "Credentials expired",
    );
  });
});
