import { afterEach, expect, it } from "vite-plus/test";

import { ClipboardApiUnavailableError, ClipboardWriteError } from "../hooks/useCopyToClipboard";
import { changeLanguage } from "../i18n";
import {
  threadReferenceCopyFailureToast,
  threadReferenceCopySuccessToast,
} from "./threadReferenceCopyToasts";

afterEach(async () => changeLanguage("en"));

it.each([
  ["pull-request", "https://github.com/acme/raw/pull/3", "已复制拉取请求链接"],
  ["thread", "thread:raw/原文", "已复制会话 ID"],
] as const)(
  "uses the current language for a %s copy and preserves its value",
  async (kind, value, title) => {
    const target = { kind, value };
    await changeLanguage("en");
    expect(threadReferenceCopySuccessToast(target).description).toBe(value);
    await changeLanguage("zh");
    expect(threadReferenceCopySuccessToast(target)).toEqual({
      type: "success",
      title,
      description: value,
    });
  },
);

it.each([
  [
    "pull-request",
    "pull request link",
    "复制拉取请求链接失败",
    "复制拉取请求链接时，剪贴板接口不可用。",
    "无法将拉取请求链接复制到剪贴板。",
  ],
  [
    "thread",
    "thread ID",
    "复制会话 ID 失败",
    "复制会话 ID 时，剪贴板接口不可用。",
    "无法将会话 ID 复制到剪贴板。",
  ],
] as const)(
  "translates structural clipboard failures for a %s",
  async (kind, target, title, unavailable, failed) => {
    await changeLanguage("zh");
    expect(
      threadReferenceCopyFailureToast({ kind }, new ClipboardApiUnavailableError({ target })),
    ).toEqual({ type: "error", title, description: unavailable });
    expect(
      threadReferenceCopyFailureToast(
        { kind },
        new ClipboardWriteError({ target, cause: new Error("Raw write diagnostic") }),
      ),
    ).toEqual({ type: "error", title, description: failed });
  },
);

it("retains an unrecognized diagnostic and translates only the generic fallback", async () => {
  await changeLanguage("zh");
  expect(
    threadReferenceCopyFailureToast({ kind: "pull-request" }, new Error("Raw diagnostic 原文"))
      .description,
  ).toBe("Raw diagnostic 原文");
  expect(threadReferenceCopyFailureToast({ kind: "thread" }, null).description).toBe("发生错误。");
});
