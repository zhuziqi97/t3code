import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { resolveExternalWebLinkHref, showExternalLinkContextMenu } from "./externalLinkContextMenu";

import { changeLanguage } from "~/i18n";

afterEach(async () => {
  await changeLanguage("en");
});

function createHarness(
  selection:
    | "open-in-preview"
    | "open-external"
    | "copy-link"
    | "link-to-thread"
    | "unlink-from-thread"
    | null,
) {
  const showContextMenu = vi.fn().mockResolvedValue(selection);
  const openInPreview = vi.fn().mockResolvedValue(undefined);
  const openExternal = vi.fn().mockResolvedValue(undefined);
  const copyLink = vi.fn().mockResolvedValue(undefined);
  const updateThreadLink = vi.fn().mockResolvedValue(undefined);
  const reportFailure = vi.fn();

  return {
    showContextMenu,
    openInPreview,
    openExternal,
    copyLink,
    updateThreadLink,
    reportFailure,
  };
}

describe("external chat link context menu", () => {
  it.each([
    [
      "https://example.com/docs?topic=security#links",
      "https://example.com/docs?topic=security#links",
    ],
    ["HTTP://EXAMPLE.COM", "http://example.com/"],
    ["//example.com/path", "https://example.com/path"],
  ])("resolves the safe external web-link href for %s as %s", (href, expected) => {
    expect(resolveExternalWebLinkHref(href)).toBe(expected);
  });

  it.each([
    "javascript:alert(document.domain)",
    " \nJaVaScRiPt:alert(document.domain)",
    "data:text/html,<script>alert(document.domain)</script>",
    "file:///tmp/example.txt",
    "mailto:hello@example.com",
    "/relative/path",
    "not a URL",
    "",
  ])("rejects unsafe external web-link href %s", (href) => {
    expect(resolveExternalWebLinkHref(href)).toBeNull();
  });
});

it("uses the active menu language while keeping selection ids and raw link destinations", async () => {
  await changeLanguage("zh");
  const href = "https://qa.test/raw?value=原文&literal={{x}}#fragment";
  const harness = createHarness("copy-link");
  await showExternalLinkContextMenu({ href, position: { x: 1, y: 2 }, ...harness });
  expect(harness.showContextMenu).toHaveBeenCalledWith(
    [
      { id: "open-in-preview", label: "在内置浏览器打开" },
      { id: "open-external", label: "在系统浏览器中打开" },
      { id: "copy-link", label: "复制链接" },
    ],
    { x: 1, y: 2 },
  );
  expect(harness.copyLink).toHaveBeenCalledExactlyOnceWith(href);
  await changeLanguage("en");
  const second = createHarness("open-in-preview");
  await showExternalLinkContextMenu({ href, position: { x: 3, y: 4 }, ...second });
  expect(second.openInPreview).toHaveBeenCalledExactlyOnceWith(href);
  expect(second.showContextMenu.mock.calls[0]?.[0]?.[0]).toEqual({
    id: "open-in-preview",
    label: "Open in integrated browser",
  });
});
