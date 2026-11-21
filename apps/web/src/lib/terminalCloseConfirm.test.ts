import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "~/i18n";

const { confirmMock, readLocalApiMock, settingsMock, hydrateMock } = vi.hoisted(() => {
  const confirmMock = vi.fn<(message: string, options?: unknown) => Promise<boolean>>();
  const readLocalApiMock = vi.fn<
    () =>
      | {
          dialogs: { confirm: (message: string, options?: unknown) => Promise<boolean> };
        }
      | undefined
  >();
  return {
    confirmMock,
    readLocalApiMock,
    settingsMock: { confirmTerminalClose: true },
    hydrateMock: vi.fn<() => Promise<void>>(),
  };
});

vi.mock("~/hooks/useSettings", () => ({
  getClientSettings: () => settingsMock,
  ensureClientSettingsHydrated: () => hydrateMock(),
}));

vi.mock("~/localApi", () => ({
  readLocalApi: () => readLocalApiMock(),
}));

import { confirmTerminalClose, isTerminalCloseConfirmPending } from "./terminalCloseConfirm";

describe("terminal close confirmation", () => {
  beforeEach(() => {
    settingsMock.confirmTerminalClose = true;
    hydrateMock.mockReset();
    hydrateMock.mockResolvedValue(undefined);
    confirmMock.mockReset();
    readLocalApiMock.mockReset();
    readLocalApiMock.mockReturnValue({ dialogs: { confirm: confirmMock } });
  });

  it("closes single and multiple terminals immediately when confirmation is disabled", async () => {
    settingsMock.confirmTerminalClose = false;

    await expect(confirmTerminalClose(["Terminal 1"])).resolves.toBe(true);
    await expect(confirmTerminalClose(["Terminal 1", "Terminal 2"])).resolves.toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(isTerminalCloseConfirmPending()).toBe(false);

    settingsMock.confirmTerminalClose = true;
    confirmMock.mockResolvedValue(false);
    await expect(confirmTerminalClose(["Terminal 1"])).resolves.toBe(false);
    expect(confirmMock).toHaveBeenCalledOnce();
  });

  it("waits for the saved opt-out before closing immediately after reload", async () => {
    let finishHydration: () => void = () => undefined;
    hydrateMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishHydration = () => {
            settingsMock.confirmTerminalClose = false;
            resolve();
          };
        }),
    );

    const close = confirmTerminalClose(["Terminal 1"]);
    expect(isTerminalCloseConfirmPending()).toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();

    finishHydration();
    await expect(close).resolves.toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(isTerminalCloseConfirmPending()).toBe(false);
  });

  it("asks for confirmation when saved settings cannot be loaded", async () => {
    settingsMock.confirmTerminalClose = false;
    hydrateMock.mockRejectedValue(new Error("storage unavailable"));
    confirmMock.mockResolvedValue(false);

    await expect(confirmTerminalClose(["Terminal 1"])).resolves.toBe(false);
    expect(confirmMock).toHaveBeenCalledOnce();
    expect(isTerminalCloseConfirmPending()).toBe(false);
  });

  it("clears pending state and resolves false when the dialog rejects", async () => {
    let reject: (reason?: unknown) => void = () => undefined;
    confirmMock.mockImplementation(
      () =>
        new Promise<boolean>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );

    const confirmation = confirmTerminalClose(["Terminal 1"]);
    expect(isTerminalCloseConfirmPending()).toBe(true);

    await hydrateMock.mock.results[0]!.value;
    reject(new Error("dialog failed"));
    await expect(confirmation).resolves.toBe(false);
    expect(isTerminalCloseConfirmPending()).toBe(false);
  });

  it("names every terminal in a multi-terminal close", async () => {
    confirmMock.mockResolvedValue(true);

    await expect(confirmTerminalClose(["Terminal 1", "Development server"])).resolves.toBe(true);
    expect(confirmMock).toHaveBeenCalledWith(
      [
        "Close 2 terminals?",
        'This stops their running processes and clears their histories: "Terminal 1", "Development server".',
      ].join("\n"),
      { variant: "destructive" },
    );
  });

  it("keeps user terminal labels intact in Chinese and honors cancellation", async () => {
    confirmMock.mockResolvedValue(false);
    await expect(
      confirmTerminalClose(["My npm dev", "日志 shell"], i18n.getFixedT("zh")),
    ).resolves.toBe(false);
    expect(confirmMock).toHaveBeenCalledExactlyOnceWith(
      '关闭 2 个终端？\n这会停止这些终端中正在运行的进程，并清空终端历史："My npm dev", "日志 shell"。',
      { variant: "destructive" },
    );
    expect(isTerminalCloseConfirmPending()).toBe(false);

    confirmMock.mockClear().mockResolvedValue(true);
    await expect(confirmTerminalClose(["My npm dev"], i18n.getFixedT("zh"))).resolves.toBe(true);
    expect(confirmMock).toHaveBeenCalledExactlyOnceWith(
      "关闭终端“My npm dev”？\n这会停止正在运行的进程，并清空终端历史。",
      { variant: "destructive" },
    );
  });

  it("closes without prompting when no local API is available", async () => {
    readLocalApiMock.mockReturnValue(undefined);

    await expect(confirmTerminalClose(["Terminal 1"])).resolves.toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
  });
});
