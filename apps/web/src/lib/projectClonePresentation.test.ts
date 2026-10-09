import { describe, expect, it } from "vite-plus/test";
import { i18n } from "../i18n";
import { localizedProjectCloneProgressSummary } from "./projectClonePresentation";

describe("clone progress presentation", () => {
  it("localizes the stage while preserving the real percentage and Git progress detail", () => {
    const snapshot = { stage: "receiving" as const, percent: 45, detail: "12.3 MiB | 5.0 MiB/s" };
    expect(localizedProjectCloneProgressSummary(snapshot, i18n.getFixedT("zh"))).toBe(
      "正在接收对象 · 45% · 12.3 MiB | 5.0 MiB/s",
    );
    expect(localizedProjectCloneProgressSummary(snapshot, i18n.getFixedT("en"))).toBe(
      "Receiving objects · 45% · 12.3 MiB | 5.0 MiB/s",
    );
  });
});
