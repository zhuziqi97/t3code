// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { buildConnectAuthorizeRequestUrl } from "@t3tools/shared/connectAuth";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: false, openSignIn: vi.fn() }));
vi.mock("@clerk/react", () => ({
  useAuth: () => auth,
  useClerk: () => ({ openSignIn: auth.openSignIn }),
}));
import { changeLanguage } from "../../i18n";
import { ConnectCliAuthorizeSurface } from "./ConnectCliAuthSurface";

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  auth.openSignIn.mockClear();
  await changeLanguage("en");
  window.history.replaceState(null, "", "/connect");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  await changeLanguage("en");
});

it("translates an incomplete authorization link and preserves the terminal command", async () => {
  await act(async () => root.render(<ConnectCliAuthorizeSurface />));
  expect(container.querySelector("h1")?.textContent).toBe("This connect link is incomplete");
  await act(async () => changeLanguage("zh"));
  expect(container.querySelector("h1")?.textContent).toBe("连接链接不完整");
  expect(container.textContent).toContain("请在终端重新运行 `t3 connect`");
  expect(auth.openSignIn).not.toHaveBeenCalled();
});

it("changes the sign-in surface while preserving the CLI request and retry redirect", async () => {
  const url = buildConnectAuthorizeRequestUrl({
    hostedAppUrl: window.location.origin,
    state: "state-raw",
    challenge: "challenge-raw",
    loopbackPort: 49152,
  });
  window.history.replaceState(null, "", url);
  await act(async () => root.render(<ConnectCliAuthorizeSurface />));
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
