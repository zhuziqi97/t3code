// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ connect: vi.fn(), submit: vi.fn(), token: "Raw-Pairing-Token" }));
vi.mock("../../connection/onboarding", () => ({ connectPairing: {} }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.connect }));
vi.mock("../../environments/primary", () => ({
  peekPairingTokenFromUrl: () => state.token,
  stripPairingTokenFromUrl: vi.fn(),
  submitServerAuthCredential: state.submit,
}));
vi.mock("../../hostedPairing", () => ({
  readHostedPairingRequest: () => ({
    host: "https://host.example",
    token: state.token,
    label: "Build Host",
  }),
}));
import { changeLanguage } from "../../i18n";
import { HostedPairingRouteSurface, PairingRouteSurface } from "./PairingRouteSurface";
function deferred<A>() {
  let resolve!: (value: A) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<A>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.connect.mockReset();
  state.submit.mockReset();
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.unstubAllGlobals();
});

it("relocalizes hosted pairing progress and completion without resubmitting the token", async () => {
  const result = deferred<{ _tag: "Success"; value: undefined }>();
  state.connect.mockReturnValue(result.promise);
  await act(() => root.render(<HostedPairingRouteSurface />));
  expect(state.connect).toHaveBeenCalledExactlyOnceWith({
    host: "https://host.example",
    pairingCode: state.token,
  });
  await act(async () => {
    await changeLanguage("zh");
  });
  expect(container.textContent).toContain("正在连接");
  expect(container.textContent).toContain("https://host.example");
  await act(async () => result.resolve({ _tag: "Success", value: undefined }));
  expect(container.textContent).toContain("Build Host");
  expect(container.textContent).toContain("已配对");
  await act(async () => {
    await changeLanguage("en");
  });
  expect(container.textContent).toContain("Backend paired");
  expect(state.connect).toHaveBeenCalledTimes(1);
});

it("keeps a submitted credential and localizes unknown errors without restarting authentication", async () => {
  const result = deferred<void>();
  state.submit.mockReturnValue(result.promise);
  const authenticated = vi.fn();
  await act(() =>
    root.render(
      <PairingRouteSurface
        auth={{
          policy: "loopback-browser",
          bootstrapMethods: ["one-time-token"],
          sessionMethods: ["browser-session-cookie"],
          sessionCookieName: "test-session",
        }}
        onAuthenticated={authenticated}
      />,
    ),
  );
  expect(state.submit).toHaveBeenCalledExactlyOnceWith(state.token);
  await act(async () => {
    await changeLanguage("zh");
  });
  expect(container.querySelector<HTMLInputElement>("input")?.value).toBe(state.token);
  await act(async () => result.reject({}));
  expect(container.textContent).toContain("身份验证失败");
  await act(async () => {
    await changeLanguage("en");
  });
  expect(container.textContent).toContain("Authentication failed");
  expect(state.submit).toHaveBeenCalledTimes(1);
  expect(authenticated).not.toHaveBeenCalled();
});
