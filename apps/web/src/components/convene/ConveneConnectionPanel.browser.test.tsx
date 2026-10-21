import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../../test/render";
import { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

import { expect, it, vi } from "vite-plus/test";

const model = vi.hoisted(() => ({
  manage: vi.fn(),
  copy: vi.fn(),
  ttl: 30,
  status: {
    platformUrls: ["https://one.example.test", "https://two.example.test/"],
    phase: "unpaired",
    runnerId: null as string | null,
    baseUrl: null as string | null,
    error: null,
  },
}));
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<typeof import("@effect/atom-react")>()),
  useAtomValue: (atom: string) => (atom === "status" ? AsyncResult.success(model.status) : true),
}));
vi.mock("../../state/convene", async (original) => ({
  ...(await original<typeof import("../../state/convene")>()),
  conveneEnvironment: { status: () => "status", manage: { permissionAtom: () => "permission" } },
}));
vi.mock("../../state/use-atom-command", async (original) => ({
  ...(await original<typeof import("../../state/use-atom-command")>()),
  useAtomCommand: () => model.manage,
}));
vi.mock("../../hooks/useCopyToClipboard", async (original) => ({
  ...(await original<typeof import("../../hooks/useCopyToClipboard")>()),
  writeTextToClipboard: model.copy,
}));
import { changeLanguage } from "../../i18n";
import { ConveneConnectionPanel } from "./ConveneConnectionPanel";

let root: Screen;
let container: HTMLDivElement;
const pairingLink = "http://localhost/execution/runner-pairing?user_code=ABCD-EFGH-JKLM";

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function pair() {
  await enterUrl("http://localhost");
  await click("Connect Convene");
}
async function enterUrl(url: string) {
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, url);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}
const exchanges = () =>
  model.manage.mock.calls.filter(([args]) => args.input.operation === "exchange");

it("selects either configured address and keeps a custom address after leaving the input", async () => {
  await using _lifecycle = await setupLifecycle();

  const input = container.querySelector("input")!;
  expect(input.value).toBe("https://one.example.test");
  await act(async () =>
    container.querySelector<HTMLButtonElement>("[data-slot=autocomplete-trigger]")!.click(),
  );
  const options = [...document.querySelectorAll<HTMLElement>("[role=option]")];
  expect(options.map((option) => option.textContent)).toEqual([
    "https://one.example.test",
    "https://two.example.test/",
  ]);
  await act(async () => options[1]!.click());
  await click("Connect Convene");
  expect(model.manage).toHaveBeenLastCalledWith(
    expect.objectContaining({
      input: { operation: "pair", baseUrl: "https://two.example.test/" },
    }),
  );
  await click("Cancel pairing");
  await enterUrl("https://team.example.test/convene");
  await act(async () => {
    const customInput = container.querySelector("input")!;
    customInput.focus();
    customInput.blur();
  });
  await click("Connect Convene");
  expect(model.manage).toHaveBeenLastCalledWith(
    expect.objectContaining({
      input: { operation: "pair", baseUrl: "https://team.example.test/convene" },
    }),
  );
});

it("uses only the current environment presets", async () => {
  await using _lifecycle = await setupLifecycle();

  model.status.platformUrls = ["https://acceptance.example.test"];
  await act(async () =>
    root.rerender(
      <ConveneConnectionPanel key="acceptance" environmentId={EnvironmentId.make("local")} />,
    ),
  );
  expect(container.querySelector("input")!.value).toBe("https://acceptance.example.test");
  await act(async () =>
    container.querySelector<HTMLButtonElement>("[data-slot=autocomplete-trigger]")!.click(),
  );
  expect(
    [...document.querySelectorAll<HTMLElement>("[role=option]")].map(
      (option) => option.textContent,
    ),
  ).toEqual(["https://acceptance.example.test"]);
  await click("Connect Convene");
  expect(model.manage).toHaveBeenLastCalledWith(
    expect.objectContaining({
      input: { operation: "pair", baseUrl: "https://acceptance.example.test" },
    }),
  );
});

it("retains a typed address on Escape and does not submit while choosing a suggestion", async () => {
  await using _lifecycle = await setupLifecycle();

  await enterUrl("https://custom.example.test");
  const input = container.querySelector("input")!;
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(input.value).toBe("https://custom.example.test");
  await act(async () =>
    container.querySelector<HTMLButtonElement>("[data-slot=autocomplete-trigger]")!.click(),
  );
  let allowed = true;
  await act(async () => {
    allowed = input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  expect(allowed).toBe(false);
  expect(model.manage).not.toHaveBeenCalled();
});

it("allows a custom address when this environment has no private presets", async () => {
  await using _lifecycle = await setupLifecycle();

  model.status.platformUrls = [];
  await act(async () =>
    root.rerender(
      <ConveneConnectionPanel key="unconfigured" environmentId={EnvironmentId.make("local")} />,
    ),
  );
  expect(container.querySelector("input")!.value).toBe("");
  await pair();
  expect(model.manage).toHaveBeenCalledWith(
    expect.objectContaining({ input: { operation: "pair", baseUrl: "http://localhost" } }),
  );
});

it("copies the code and complete link, opens the same link and completes automatically after approval", async () => {
  await using _lifecycle = await setupLifecycle();

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
    platformUrls: [],
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
  model.status = {
    platformUrls: ["https://one.example.test", "https://two.example.test/"],
    phase: "unpaired",
    runnerId: null,
    baseUrl: null,
    error: null,
  };
  await act(async () =>
    root.rerender(<ConveneConnectionPanel environmentId={EnvironmentId.make("local")} />),
  );
  expect(container.textContent).toContain("Connect Convene");
  expect(container.textContent).not.toContain("Disconnect Convene");
  open.mockRestore();
});

it("stops checking when cancelled, expires without further exchanges and can request a fresh code", async () => {
  await using _lifecycle = await setupLifecycle();

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
  await using _lifecycle = await setupLifecycle();

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
  await using _lifecycle = await setupLifecycle();

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
  await act(async () => root.rerender(null));
  await act(async () => resolve(AsyncResult.success({ type: "pending" })));
  await advance(30000);
  expect(exchanges()).toHaveLength(1);
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  vi.useFakeTimers();

  await changeLanguage("en");
  model.ttl = 30;
  model.status = {
    platformUrls: ["https://one.example.test", "https://two.example.test/"],
    phase: "unpaired",
    runnerId: null,
    baseUrl: null,
    error: null,
  };
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
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));
  await act(async () =>
    root.rerender(<ConveneConnectionPanel environmentId={EnvironmentId.make("local")} />),
  );

  renderStack = stack.move();
  return renderStack;
}
