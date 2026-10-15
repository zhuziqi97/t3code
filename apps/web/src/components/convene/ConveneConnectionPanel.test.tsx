// @vitest-environment jsdom
import { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const model = vi.hoisted(() => ({
  manage: vi.fn(),
  copy: vi.fn(),
  ttl: 30,
  status: {
    phase: "unpaired",
    runnerId: null as string | null,
    baseUrl: null as string | null,
    error: null,
  },
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string) => (atom === "status" ? AsyncResult.success(model.status) : true),
}));
vi.mock("../../state/convene", () => ({
  conveneEnvironment: { status: () => "status", manage: { permissionAtom: () => "permission" } },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => model.manage }));
vi.mock("../../hooks/useCopyToClipboard", () => ({ writeTextToClipboard: model.copy }));
import { changeLanguage } from "../../i18n";
import { ConveneConnectionPanel } from "./ConveneConnectionPanel";

let root: Root;
let container: HTMLDivElement;
const pairingLink = "http://localhost/execution/runner-pairing?user_code=ABCD-EFGH-JKLM";
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLanguage("en");
  model.ttl = 30;
  model.status = { phase: "unpaired", runnerId: null, baseUrl: null, error: null };
  model.copy.mockReset().mockResolvedValue(true);
  model.manage.mockReset().mockImplementation(async ({ input }) =>
    AsyncResult.success(
      input.operation === "pair"
        ? {
            type: "pairing",
            pairing: {
              device_code: "private-device-code",
              user_code: "ABCD-EFGH-JKLM",
              verification_uri: pairingLink,
              expires_in: model.ttl,
              interval: 5,
            },
          }
        : { type: "pending" },
    ),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(<ConveneConnectionPanel environmentId={EnvironmentId.make("local")} />),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function pair() {
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "http://localhost",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Connect Convene");
}
async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}
const exchanges = () =>
  model.manage.mock.calls.filter(([args]) => args.input.operation === "exchange");

it("copies the code and complete link, opens the same link and completes automatically after approval", async () => {
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  await pair();
  await click("Copy code");
  expect(model.copy).toHaveBeenLastCalledWith("ABCD-EFGH-JKLM", "Copy code");
  await click("Copy pairing link");
  expect(model.copy).toHaveBeenLastCalledWith(pairingLink, "Copy pairing link");
  await click("Open Convene");
  expect(open).toHaveBeenCalledWith(pairingLink, "_blank", "noopener,noreferrer");
  await advance(5000);
  expect(exchanges()).toHaveLength(1);
  expect(container.textContent).toContain("Waiting for authorization");
  model.status = {
    phase: "connecting",
    runnerId: "runner",
    baseUrl: "http://localhost",
    error: null,
  };
  model.manage.mockResolvedValueOnce(
    AsyncResult.success({
      type: "status",
      status: { phase: "connecting", runnerId: "runner", baseUrl: "http://localhost", error: null },
    }),
  );
  await advance(5000);
  expect(container.textContent).toContain("Connecting to Convene");
  expect(container.textContent).toContain("Disconnect Convene");
  await advance(30000);
  expect(exchanges()).toHaveLength(2);
  model.status = { phase: "unpaired", runnerId: null, baseUrl: null, error: null };
  await act(async () =>
    root.render(<ConveneConnectionPanel environmentId={EnvironmentId.make("local")} />),
  );
  expect(container.textContent).toContain("Connect Convene");
  expect(container.textContent).not.toContain("Disconnect Convene");
  open.mockRestore();
});

it("stops checking when cancelled, expires without further exchanges and can request a fresh code", async () => {
  await pair();
  await advance(5000);
  await click("Cancel pairing");
  await advance(30000);
  expect(exchanges()).toHaveLength(1);
  model.ttl = 10;
  await pair();
  await advance(10000);
  expect(container.textContent).toContain("expired");
  const requests = exchanges().length;
  await advance(30000);
  expect(exchanges()).toHaveLength(requests);
  await click("Get a new code");
  expect(container.textContent).toContain("Waiting for authorization");
});

it("shows clipboard and connection failures truthfully and resumes checking on retry", async () => {
  await pair();
  model.copy.mockRejectedValueOnce(new Error("clipboard denied"));
  await click("Copy code");
  expect(container.textContent).toContain("Could not copy");
  model.manage.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("network down"))));
  await advance(5000);
  expect(container.textContent).toContain("Could not check the connection");
  const requests = exchanges().length;
  await advance(5000);
  expect(exchanges()).toHaveLength(requests);
  await click("Retry checking");
  await advance(5000);
  expect(exchanges()).toHaveLength(requests + 1);
  expect(container.textContent).toContain("Waiting for authorization");
});

it("does not overlap slow exchanges and stops the timer when unmounted", async () => {
  await pair();
  let resolve: (value: unknown) => void = () => {};
  model.manage.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await advance(5000);
  await advance(10000);
  expect(exchanges()).toHaveLength(1);
  await act(async () => root.render(null));
  await act(async () => resolve(AsyncResult.success({ type: "pending" })));
  await advance(30000);
  expect(exchanges()).toHaveLength(1);
});
