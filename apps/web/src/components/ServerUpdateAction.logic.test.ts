import { describe, expect, it } from "vite-plus/test";
import { createI18n } from "@t3tools/client-runtime/i18n";
import {
  ServerUpdateProgressIncompleteError,
  ServerUpdateResumeTimeoutError,
  ServerUpdateTerminalError,
} from "@t3tools/client-runtime/state/server";
import { formatServerUpdateMessage, serverUpdateStageLabel } from "./ServerUpdateAction.logic";

const t = createI18n({ lng: "zh" }).t;
const version = "0.0.45-nightly.20261010.17";

describe("server update presentation", () => {
  it("keeps the launcher handoff in the download phase in both languages", () => {
    const english = createI18n({ lng: "en" }).t;
    expect(serverUpdateStageLabel("downloading", t)).toBe("正在下载…");
    expect(serverUpdateStageLabel("installing", t)).toBe("正在下载…");
    expect(serverUpdateStageLabel("resuming", t)).toBe("正在重启…");
    expect(serverUpdateStageLabel("installing", english)).toBe("Downloading…");
  });

  it("translates messages produced by the shared update runtime and preserves the target version", () => {
    expect(
      formatServerUpdateMessage(
        new ServerUpdateResumeTimeoutError({ environmentId: "raw-env", targetVersion: version })
          .message,
        t,
      ),
    ).toBe(`服务端未能以 t3@${version} 恢复运行。`);
    expect(
      formatServerUpdateMessage(
        new ServerUpdateProgressIncompleteError({ targetVersion: version }).message,
        t,
      ),
    ).toBe(`服务端接受重启前，t3@${version} 更新已结束。`);
    expect(
      formatServerUpdateMessage(
        new ServerUpdateTerminalError({ targetVersion: version, status: "rolled-back" }).message,
        t,
      ),
    ).toBe(`t3@${version} 更新已回退。`);
    expect(
      formatServerUpdateMessage(
        new ServerUpdateTerminalError({
          targetVersion: version,
          status: "failed",
          reason: "Network /tmp/原文 404",
        }).message,
        t,
      ),
    ).toBe("Network /tmp/原文 404");
  });
});
