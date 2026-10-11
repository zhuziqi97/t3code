// @vitest-environment jsdom
import type { DesktopUpdateState } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("../ui/toast", () => ({ toastManager: { add: testState.addToast } }));
import { changeLanguage } from "../../i18n";
import { SidebarUpdateReleaseNotes } from "./SidebarUpdateReleaseNotes";

const baseState: DesktopUpdateState = {
  enabled: true,
  status: "available",
  channel: "nightly",
  currentVersion: "0.0.35",
  hostArch: "arm64",
  appArch: "arm64",
  runningUnderArm64Translation: false,
  availableVersion: "0.0.36-nightly.3",
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};
let root: Root;
let container: HTMLDivElement;
async function renderNotes(
  state: DesktopUpdateState,
  openExternal = vi.fn().mockResolvedValue(true),
) {
  await act(async () =>
    root.render(
      <SidebarUpdateReleaseNotes
        shell={{ openExternal }}
        state={state}
        tooltip="Update available"
      />,
    ),
  );
}
function links() {
  return [...container.querySelectorAll("a")];
}
beforeEach(async () => {
  testState.addToast.mockReset();
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
});

describe("SidebarUpdateReleaseNotes", () => {
  it("keeps exact release links and the focused link when changing language, including plural counts", async () => {
    const openExternal = vi.fn().mockResolvedValue(true);
    await renderNotes(
      {
        ...baseState,
        releaseNotes: [
          { version: "0.0.36-nightly.3", items: ["Raw change 中文原文"], totalItems: 1 },
          { version: "0.0.36-nightly.2", items: ["Change 2"], totalItems: 2 },
          { version: "0.0.36-nightly.1", items: ["Change 1", "Earlier"], totalItems: 4 },
        ],
      },
      openExternal,
    );
    expect(links().map((link) => link.textContent)).toEqual([
      "View release on GitHub",
      "1 more change on GitHub",
      "2 more changes on GitHub",
    ]);
    const focused = links()[1]!;
    focused.focus();
    await act(async () => {
      await changeLanguage("zh");
    });
    expect(links().map((link) => link.textContent)).toEqual([
      "在 GitHub 查看此版本",
      "在 GitHub 查看另外 1 项更改",
      "在 GitHub 查看另外 2 项更改",
    ]);
    expect(container.textContent).toContain("更新可供下载");
    expect(container.textContent).toContain("0.0.36-nightly.2 的更新内容");
    expect(container.textContent).toContain("Raw change 中文原文");
    expect(document.activeElement).toBe(focused);
    expect(openExternal).not.toHaveBeenCalled();
    await act(async () => focused.click());
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(
      "https://github.com/pingdotgg/t3code/releases/tag/v0.0.36-nightly.2",
    );
    await act(async () => {
      await changeLanguage("en");
    });
    expect(focused.textContent).toBe("1 more change on GitHub");
  });

  it.each([1, 3])(
    "links %s omitted releases to release history and retranslates the count",
    async (count) => {
      const openExternal = vi.fn().mockResolvedValue(true);
      await renderNotes(
        {
          ...baseState,
          releaseNotes: [{ version: "0.0.36-nightly.3", items: ["Change 3"], totalItems: 1 }],
          omittedReleaseCount: count,
        },
        openExternal,
      );
      const link = links().at(-1)!;
      expect(link.textContent).toBe(
        `${count} older ${count === 1 ? "release" : "releases"} on GitHub`,
      );
      await act(async () => {
        await changeLanguage("zh");
      });
      expect(link.textContent).toBe(`在 GitHub 查看 ${count} 个更早版本`);
      await act(async () => link.click());
      expect(openExternal).toHaveBeenCalledExactlyOnceWith(
        "https://github.com/pingdotgg/t3code/releases",
      );
    },
  );

  it("reports a release link that fails to open using the current language", async () => {
    const openExternal = vi.fn().mockResolvedValue(false);
    await renderNotes(
      {
        ...baseState,
        releaseNotes: [{ version: "0.0.36-nightly.3", items: ["Change 3"], totalItems: 1 }],
      },
      openExternal,
    );
    await act(async () => {
      await changeLanguage("zh");
      links()[0]!.click();
    });
    const toast = testState.addToast.mock.calls[0]![0] as { title: ReactNode };
    await act(async () => root.render(<>{toast.title}</>));
    expect(container.textContent).toBe("无法打开发布说明");
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(
      "https://github.com/pingdotgg/t3code/releases/tag/v0.0.36-nightly.3",
    );
  });
});
