import { buildDraftActionMenuItems } from "./threadActionMenu.logic";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

describe("buildThreadActionMenuItems", () => {
  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("disables archive while the thread is running", () => {
    const archiveItem = buildThreadActionMenuItems({ ...baseState, isRunning: true }).find(
      (item) => item.id === "archive",
    );
    expect(archiveItem?.disabled).toBe(true);
  });
});

describe("buildDraftActionMenuItems", () => {
  it("offers only the copy values the draft has", () => {
    const items = buildDraftActionMenuItems({ hasPath: false, hasBranch: true, hasProject: true });
    expect(items[0]).toMatchObject({ id: "copy", disabled: false });
    expect(items[0]?.children?.map((item) => item.id)).toEqual(["copy-branch"]);

    const noCopy = buildDraftActionMenuItems({
      hasPath: false,
      hasBranch: false,
      hasProject: true,
    });
    expect(noCopy[0]).toMatchObject({ id: "copy", disabled: true, children: [] });
  });

  it("drops project settings without a project and keeps discard last", () => {
    const items = buildDraftActionMenuItems({ hasPath: true, hasBranch: false, hasProject: false });
    expect(items.map((item) => item.id)).toEqual(["copy", "discard"]);
    expect(items.at(-1)).toMatchObject({ label: "Discard draft", destructive: true });
  });
});

describe("localized thread menus", () => {
  it("keeps the same native menu actions and grants while showing Chinese labels", async () => {
    const { createI18n } = await import("@t3tools/client-runtime/i18n");
    const t = createI18n().getFixedT("zh");
    const state = {
      ...baseState,
      canOperate: false,
      branch: "feat/中文",
      projectFilter: { label: "My Project", isActive: false },
    };
    const english = buildThreadActionMenuItems(state);
    const chinese = buildThreadActionMenuItems(state, t);
    expect(chinese.map(({ id, disabled }) => ({ id, disabled }))).toEqual(
      english.map(({ id, disabled }) => ({ id, disabled })),
    );
    expect(chinese.find(({ id }) => id === "new-thread-on-branch")?.label).toBe(
      "在 feat/中文 上新建会话",
    );
    expect(chinese.find(({ id }) => id === "filter-by-project")?.label).toBe(
      "筛选项目：My Project",
    );
    const snooze = chinese.find(({ id }) => id === "snooze")!;
    expect(snooze.children?.map(({ id, disabled }) => ({ id, disabled }))).toEqual(
      english
        .find(({ id }) => id === "snooze")
        ?.children?.map(({ id, disabled }) => ({ id, disabled })),
    );
    const reversed = buildThreadActionMenuItems(
      { ...state, isPinned: true, isSettled: true, isSnoozed: true },
      t,
    );
    expect(reversed.find(({ id }) => id === "unsettle")).toMatchObject({
      label: "恢复为未完成",
      disabled: true,
    });
    expect(reversed.find(({ id }) => id === "unsnooze")).toMatchObject({
      label: "唤醒会话",
      disabled: true,
    });
  });
});
