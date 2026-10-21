import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../../test/render";

import { buildConnectAuthorizeRequestUrl } from "@t3tools/shared/connectAuth";
import { expect, it, vi } from "vite-plus/test";

const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: false, openSignIn: vi.fn() }));
vi.mock("@clerk/react", async (original) => ({
  ...(await original<typeof import("@clerk/react")>()),
  useAuth: () => auth,
  useClerk: () => ({ openSignIn: auth.openSignIn }),
}));
import { changeLanguage } from "../../i18n";
import { ConnectCliAuthorizeSurface } from "./ConnectCliAuthSurface";

let root: Screen;
let container: HTMLDivElement;

it("translates an incomplete authorization link and preserves the terminal command", async () => {
  await using _lifecycle = await setupLifecycle();

  await act(async () => root.rerender(<ConnectCliAuthorizeSurface />));
  expect(container.querySelector("h1")?.textContent).toBe("This connect link is incomplete");
  await act(async () => changeLanguage("zh"));
  expect(container.querySelector("h1")?.textContent).toBe("连接链接不完整");
  expect(container.textContent).toContain("请在终端重新运行 `t3 connect`");
  expect(auth.openSignIn).not.toHaveBeenCalled();
});

it("changes the sign-in surface while preserving the CLI request and retry redirect", async () => {
  await using _lifecycle = await setupLifecycle();

  const url = buildConnectAuthorizeRequestUrl({
    hostedAppUrl: window.location.origin,
    state: "state-raw",
    challenge: "challenge-raw",
    loopbackPort: 49152,
  });
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${new URL(url).hash}`,
  );
  await act(async () => root.rerender(<ConnectCliAuthorizeSurface />));
  expect(auth.openSignIn).toHaveBeenCalledOnce();
  const redirect = auth.openSignIn.mock.calls[0];
  expect(container.querySelector("button")?.textContent).toBe("Sign in");
  await act(async () => changeLanguage("zh"));
  expect(container.querySelector("h1")?.textContent).toBe("正在连接终端");
  expect(container.querySelector("button")?.textContent).toBe("登录");
  expect(auth.openSignIn).toHaveBeenCalledOnce();
  await act(async () => container.querySelector("button")!.click());
  expect(auth.openSignIn).toHaveBeenCalledTimes(2);
  expect(auth.openSignIn.mock.calls[1]).toEqual(redirect);
  expect(window.location.hash).toContain("state=state-raw");
  expect(window.location.hash).toContain("challenge=challenge-raw");
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  const originalUrl = window.location.href;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.history.replaceState(null, "", originalUrl);
    vi.unstubAllGlobals();
    await changeLanguage("en");
  });

  auth.openSignIn.mockClear();
  await changeLanguage("en");
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));

  renderStack = stack.move();
  return renderStack;
}
