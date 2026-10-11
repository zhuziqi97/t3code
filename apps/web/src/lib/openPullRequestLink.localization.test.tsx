// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ openLink: vi.fn(), navigate: vi.fn() }));
vi.mock("../browser/useOpenLink", () => ({ useOpenLink: () => state.openLink }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
vi.mock("../state/entities", () => ({ useProjects: () => [], useServerConfigs: () => new Map() }));
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => "env-qa" }));

import { changeLanguage } from "../i18n";
import { toastManager } from "../components/ui/toast";
import { useOpenPrLink } from "./openPullRequestLink";

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await changeLanguage("en");
});

it("reports a pending external PR link failure in the new language with the raw diagnostic", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Link />));
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
        title: "无法打开拉取请求链接",
        description: "Raw open diagnostic 原文",
      }),
    );
    expect(state.navigate).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
