import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../test/render";

import { type ComponentProps } from "react";

import { expect, it, vi } from "vite-plus/test";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";

import { changeLanguage } from "../i18n";
import { RightPanelTabs } from "./RightPanelTabs";

vi.mock("~/hooks/useTheme", async (original) => ({
  ...(await original<typeof import("~/hooks/useTheme")>()),
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("~/browser/browserDefaults", async (original) => ({
  ...(await original<typeof import("~/browser/browserDefaults")>()),
  useBrowserDefaults: () => ({
    profiles: [
      { id: "work", name: "Work Profile" },
      { id: "personal", name: "Personal Profile" },
    ],
  }),
}));

let root: Screen;
let container: HTMLDivElement;
const addFiles = vi.fn();
const noop = () => undefined;

async function renderPanel(overrides: Partial<ComponentProps<typeof RightPanelTabs>> = {}) {
  await act(() =>
    root.rerender(
      <RightPanelTabs
        mode="inline"
        open
        keybindings={DEFAULT_RESOLVED_KEYBINDINGS}
        getShortcutContext={() => ({
          terminalFocus: false,
          terminalOpen: false,
          previewFocus: false,
          previewOpen: false,
          isWeb: true,
          isDesktop: false,
        })}
        surfaces={[]}
        environmentId={null}
        activeSurfaceId={null}
        pendingSurfaceIds={new Set()}
        previewSessions={{}}
        desktopByTabId={{}}
        terminalLabelsById={new Map()}
        onActivate={noop}
        onCloseSurface={noop}
        onCloseOtherSurfaces={noop}
        onCloseSurfacesToRight={noop}
        onCloseAllSurfaces={noop}
        onCopyFilePath={noop}
        onAddBrowser={noop}
        onAddBrowserInProfile={noop}
        onAddTerminal={noop}
        onAddDiff={noop}
        onAddFiles={addFiles}
        onAddPullRequest={noop}
        onAddPullRequests={noop}
        onAddDevice={noop}
        browserAvailable={false}
        terminalAvailable={false}
        diffAvailable={false}
        filesAvailable
        pullRequestAvailable={false}
        pullRequestsAvailable={false}
        deviceAvailable={false}
        {...overrides}
      >
        content
      </RightPanelTabs>,
    ),
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  await act(() => vi.advanceTimersToNextFrame());
}

it("keeps the browser profile chooser usable after a language switch", async () => {
  await using _lifecycle = await setupLifecycle();

  const addProfile = vi.fn();
  await renderPanel({ browserAvailable: true, onAddBrowserInProfile: addProfile });
  await act(async () => {
    await changeLanguage("zh");
  });
  const chooser = container.querySelector<HTMLButtonElement>(
    '[aria-label="使用指定配置打开浏览器"]',
  );
  expect(chooser).not.toBeNull();
  await act(async () => chooser!.click());
  await act(() => vi.advanceTimersByTimeAsync(0));
  const personal = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === "Personal Profile",
  );
  expect(personal).toBeDefined();
  await act(async () => personal!.click());
  expect(addProfile).toHaveBeenCalledExactlyOnceWith("personal");
  await act(async () => {
    await changeLanguage("en");
  });
  expect(container.querySelector('[aria-label="Open browser in a profile"]')).not.toBeNull();
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(() => root.unmount());
    container.remove();
    await changeLanguage("en");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  await changeLanguage("en");
  vi.useFakeTimers();

  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  addFiles.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));

  renderStack = stack.move();
  return renderStack;
}
