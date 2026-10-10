import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { presentSavedCloudEnvironmentConnection } from "./cloudEnvironmentConnectionPresentation";

import { changeLanguage } from "../../i18n";

afterEach(async () => {
  await changeLanguage("en");
});

it("translates a saved connection's authentication failure without changing its state", async () => {
  const snapshot = connection("reconnecting", "The environment credential is invalid.");
  await changeLanguage("zh");
  expect(presentSavedCloudEnvironmentConnection(snapshot).statusText).toBe(
    "连接失败，正在重新连接… 原因：执行环境凭据无效。",
  );
  await changeLanguage("en");
  expect(presentSavedCloudEnvironmentConnection(snapshot).statusText).toBe(
    "Failed to connect. Reconnecting... Reason: The environment credential is invalid.",
  );
  expect(snapshot.error).toBe("The environment credential is invalid.");
});

function connection(
  phase: EnvironmentConnectionPresentation["phase"],
  error: string | null = null,
): EnvironmentConnectionPresentation {
  return { phase, error, traceId: null };
}

describe("saved cloud environment connection presentation", () => {
  it("only labels a live connection as connected", () => {
    expect(presentSavedCloudEnvironmentConnection(connection("connected"))).toEqual({
      buttonLabel: "Connected",
      statusText: "Connected",
      tone: "connected",
    });

    expect(presentSavedCloudEnvironmentConnection(connection("connecting"))).toEqual({
      buttonLabel: "Connecting…",
      statusText: "Connecting...",
      tone: "connecting",
    });
  });

  it("surfaces a failed attempt while the supervisor reconnects", () => {
    expect(
      presentSavedCloudEnvironmentConnection(
        connection("reconnecting", "Relay environment endpoint is unavailable."),
      ),
    ).toEqual({
      buttonLabel: "Reconnecting…",
      statusText:
        "Failed to connect. Reconnecting... Reason: Relay environment endpoint is unavailable.",
      tone: "connecting",
    });
  });

  it.each([
    ["error", "Connection failed", "Connection failed. Reason: Access denied.", "error"],
    ["unsupported", "Client not supported", "Client not supported", "idle"],
    ["offline", "Offline", "Offline", "idle"],
    ["available", "Not connected", "Available", "idle"],
  ] as const)(
    "presents %s without claiming the environment is connected",
    (phase, buttonLabel, statusText, tone) => {
      expect(
        presentSavedCloudEnvironmentConnection(
          connection(phase, phase === "error" ? "Access denied." : null),
        ),
      ).toEqual({ buttonLabel, statusText, tone });
    },
  );
});

it("keeps all seven connection phases distinct in Chinese and preserves the failure reason", async () => {
  await changeLanguage("zh");
  for (const [phase, label, tone] of [
    ["connected", "已连接", "connected"],
    ["connecting", "正在连接…", "connecting"],
    ["reconnecting", "正在重新连接…", "connecting"],
    ["unsupported", "此客户端不受支持", "idle"],
    ["error", "连接失败", "error"],
    ["offline", "离线", "idle"],
    ["available", "尚未连接", "idle"],
  ] as const) {
    expect(presentSavedCloudEnvironmentConnection(connection(phase))).toMatchObject({
      buttonLabel: label,
      tone,
    });
  }
  expect(
    presentSavedCloudEnvironmentConnection(connection("reconnecting", "Relay endpoint unavailable"))
      .statusText,
  ).toBe("连接失败，正在重新连接… 原因：Relay endpoint unavailable");
});
