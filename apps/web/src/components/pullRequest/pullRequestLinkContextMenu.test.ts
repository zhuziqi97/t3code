import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const api = vi.hoisted(() => ({
  contextMenu: { show: vi.fn() },
  shell: { openExternal: vi.fn() },
}));
vi.mock("../../localApi", () => ({ readLocalApi: () => api }));

import { changeLanguage } from "../../i18n";
import { toastManager } from "../ui/toast";
import { openOnHostLabel, showPullRequestLinkContextMenu } from "./pullRequestLinkContextMenu";

beforeEach(async () => {
  await changeLanguage("en");
  vi.clearAllMocks();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await changeLanguage("en");
});

it("names the provider in the active language and sends the original URL to the selected action", async () => {
  await changeLanguage("zh");
  api.contextMenu.show.mockResolvedValue("open-external");
  api.shell.openExternal.mockResolvedValue(undefined);
  const url = "https://gitlab.example.test/team/raw/-/merge_requests/12";
  await showPullRequestLinkContextMenu({
    url,
    openLabel: openOnHostLabel("gitlab"),
    position: { x: 8, y: 12 },
  });
  expect(api.contextMenu.show).toHaveBeenCalledWith(
    [
      { id: "copy-link", label: "复制链接", icon: "copy" },
      { id: "open-external", label: "在 GitLab 上打开" },
    ],
    { x: 8, y: 12 },
  );
  expect(api.shell.openExternal).toHaveBeenCalledExactlyOnceWith(url);
});

it("reports a pending native link failure in the language selected while it was opening", async () => {
  const add = vi.spyOn(toastManager, "add").mockReturnValue("toast");
  api.contextMenu.show.mockResolvedValue("open-external");
  let reject!: (error: Error) => void;
  let started!: () => void;
  const opening = new Promise<void>((resolve) => {
    started = resolve;
  });
  api.shell.openExternal.mockImplementation(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
        started();
      }),
  );
  const pending = showPullRequestLinkContextMenu({
    url: "https://github.com/acme/raw/pull/3",
    openLabel: openOnHostLabel("github"),
    position: { x: 0, y: 0 },
  });
  await opening;
  await changeLanguage("zh");
  reject(new Error("Raw native diagnostic"));
  await pending;
  expect(add).toHaveBeenCalledExactlyOnceWith({ type: "error", title: "无法打开链接" });
});

it("leaves a dismissed native menu without a clipboard or browser action", async () => {
  api.contextMenu.show.mockResolvedValue(null);
  await showPullRequestLinkContextMenu({
    url: "https://github.com/acme/raw/pull/3",
    openLabel: openOnHostLabel("github"),
    position: { x: 0, y: 0 },
  });
  expect(api.shell.openExternal).not.toHaveBeenCalled();
});
