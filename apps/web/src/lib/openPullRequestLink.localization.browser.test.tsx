import "~/index.css";
import { act, render as renderTestUi } from "../../test/render";

import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ openLink: vi.fn(), navigate: vi.fn() }));
vi.mock("../browser/useOpenLink", async (original) => ({
  ...(await original<typeof import("../browser/useOpenLink")>()),
  useOpenLink: () => state.openLink,
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => state.navigate,
}));
vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  useProjects: () => [],
  useServerConfigs: () => new Map(),
}));
vi.mock("../state/environments", async (original) => ({
  ...(await original<typeof import("../state/environments")>()),
  usePrimaryEnvironmentId: () => "env-qa",
}));

import { changeLanguage } from "../i18n";
import { toastManager } from "../components/ui/toast";
import { useOpenPrLink } from "./openPullRequestLink";

it("reports a pending external PR link failure in the new language with the raw diagnostic", async () => {
  await using _lifecycle = await setupLifecycle();

  vi.spyOn(console, "error").mockImplementation(() => {});
  const add = vi.spyOn(toastManager, "add").mockReturnValue("toast");
  await changeLanguage("en");
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_, fail) => {
    reject = fail;
  });
  state.openLink.mockReturnValue(pending);
  const url = "https://github.com/acme/raw/pull/123";
  function Link() {
    const open = useOpenPrLink();
    return <button onClick={(event) => open(event, url)}>Open PR</button>;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = renderStack.use(await renderTestUi(null, { container: container, router: false }));
  try {
    await act(async () => root.rerender(<Link />));
    await act(async () => container.querySelector("button")!.click());
    expect(state.openLink).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ threadRef: undefined }),
    );
    await act(async () => changeLanguage("zh"));
    await act(async () => {
      reject(new Error("Raw open diagnostic 原文"));
      await pending.catch(() => {});
    });
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        title: "无法打开 Pull Request 链接",
        description: "Raw open diagnostic 原文",
      }),
    );
    expect(state.navigate).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await changeLanguage("en");
  });

  renderStack = stack.move();
  return renderStack;
}
