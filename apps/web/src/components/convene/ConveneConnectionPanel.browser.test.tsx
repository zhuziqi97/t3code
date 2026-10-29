import "~/index.css";
import { act, fakeTimers, render as renderTestUi, type Screen } from "../../../test/render";
import { RegistryContext } from "@effect/atom-react";
import {
  ConveneIntegrationError,
  EnvironmentId,
  type ConveneManageResult,
  type ConveneStatus,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { expect, it, vi } from "vite-plus/test";

const model = vi.hoisted(() => ({
  manage: vi.fn(),
  copy: vi.fn(),
  ttl: 30,
}));
vi.mock("../../state/convene", () => ({
  conveneEnvironment: {
    status: ({ environmentId }: { environmentId: string }) => statusAtom(environmentId),
    manage: {
      permissionAtom: (environmentId: string) => permissionAtom(environmentId),
    },
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => model.manage,
}));
vi.mock("../../hooks/useCopyToClipboard", () => ({
  writeTextToClipboard: model.copy,
}));
import { changeLanguage } from "../../i18n";
import { ConveneConnectionPanel } from "./ConveneConnectionPanel";

let root: Screen;
let container: HTMLDivElement;
let registry: AtomRegistry.AtomRegistry;
const pairingLink = "http://localhost/execution/runner-pairing?user_code=ABCD-EFGH-JKLM";
const initialStatus: ConveneStatus = {
  platformUrls: ["https://one.example.test", "https://two.example.test/"],
  phase: "unpaired",
  runnerId: null,
  baseUrl: null,
  error: null,
};
const statusAtom = Atom.family((environmentId: string) =>
  Atom.make<AsyncResult.AsyncResult<ConveneStatus, Error>>(AsyncResult.success(initialStatus)).pipe(
    Atom.withLabel(`test:convene-status:${environmentId}`),
  ),
);
const permissionAtom = Atom.family((environmentId: string) =>
  Atom.make(true).pipe(Atom.withLabel(`test:convene-manage-permission:${environmentId}`)),
);

async function setStatus(status: ConveneStatus, environmentId = "local") {
  await act(() => registry.set(statusAtom(environmentId), AsyncResult.success(status)));
}

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

const connectedStatus = {
  platformUrls: ["https://one.example.test", "https://two.example.test/"],
  phase: "offline",
  runnerId: "existing-runner",
  baseUrl: "http://old.example.test/convene",
  error: null,
} satisfies ConveneStatus;
type ManageResult = AtomCommandResult<typeof ConveneManageResult.Type, Error>;

async function showEnvironment(environmentId = "local") {
  await act(() =>
    root.rerender(
      <RegistryContext.Provider value={registry}>
        <ConveneConnectionPanel environmentId={EnvironmentId.make(environmentId)} />
      </RegistryContext.Provider>,
    ),
  );
}

it("edits paired address presets and custom input without changing the connection when cancelled", async () => {
  await using _lifecycle = await setupLifecycle();
  await setStatus(connectedStatus);

  await click("Change address");
  expect(container.querySelector("input")!.value).toBe(connectedStatus.baseUrl);
  await act(() =>
    container.querySelector<HTMLButtonElement>("[data-slot=autocomplete-trigger]")!.click(),
  );
  const options = [...document.querySelectorAll<HTMLElement>("[role=option]")];
  expect(options.map((option) => option.textContent)).toEqual(connectedStatus.platformUrls);
  await act(() => options[1]!.click());
  expect(container.querySelector("input")!.value).toBe("https://two.example.test/");
  expect(container.textContent).toContain(connectedStatus.baseUrl);
  expect(container.textContent).toContain(connectedStatus.runnerId);
  await click("Cancel");
  expect(container.querySelector("input")).toBeNull();
  await click("Change address");
  expect(container.querySelector("input")!.value).toBe(connectedStatus.baseUrl);
  await enterUrl("https://custom.example.test/prefix");
  await click("Cancel");
  expect(container.textContent).toContain(connectedStatus.baseUrl);
  expect(container.textContent).toContain(connectedStatus.runnerId);
  expect(model.manage).not.toHaveBeenCalled();
});

it("saves the paired address without re-pairing or treating the RPC acknowledgement as online status", async () => {
  await using _lifecycle = await setupLifecycle();
  await setStatus(connectedStatus);
  const previousStatus = container.querySelector('[role="status"]')!.textContent;
  let finishSave!: (result: ManageResult) => void;
  model.manage.mockReturnValueOnce(
    new Promise<ManageResult>((resolve) => {
      finishSave = resolve;
    }),
  );
  const baseUrl = "https://custom.example.test/convene";

  await click("Change address");
  await enterUrl(baseUrl);
  await click("Save");
  expect(model.manage).toHaveBeenCalledExactlyOnceWith({
    environmentId: "local",
    input: { operation: "change-address", baseUrl },
  });
  expect(container.querySelector("input")!.disabled).toBe(true);
  expect(container.textContent).toContain(connectedStatus.baseUrl);
  await act(() =>
    finishSave(
      AsyncResult.success({
        type: "status",
        status: { ...connectedStatus, phase: "online", baseUrl },
      }),
    ),
  );
  expect(container.querySelector("input")).toBeNull();
  expect(container.querySelector('[role="status"]')!.textContent).toBe(previousStatus);
  expect(container.textContent).toContain(connectedStatus.baseUrl);
  expect(container.textContent).not.toContain(baseUrl);
  expect(container.textContent).toContain(connectedStatus.runnerId);

  await setStatus({ ...connectedStatus, phase: "connecting", baseUrl });
  expect(container.textContent).toContain("Connecting to Convene");
  expect(container.textContent).toContain(baseUrl);
  expect(container.textContent).not.toContain(connectedStatus.baseUrl);
  expect(container.textContent).toContain(connectedStatus.runnerId);
});

it.each([
  ["INVALID_PLATFORM_URL", "Enter a valid Convene platform address"],
  ["PLATFORM_UNAVAILABLE", "Could not change the address"],
] as const)("keeps the address draft and existing connection after %s", async (code, message) => {
  await using _lifecycle = await setupLifecycle();
  await setStatus(connectedStatus);
  model.manage.mockResolvedValueOnce(
    AsyncResult.failure(
      Cause.fail(new ConveneIntegrationError({ operation: "change-address", code })),
    ),
  );
  const baseUrl = "https://replacement.example.test/convene";
  await click("Change address");
  await enterUrl(baseUrl);
  await click("Save");
  expect(container.querySelector("input")!.value).toBe(baseUrl);
  expect(container.querySelector('[role="alert"]')!.textContent).toContain(message);
  expect(container.textContent).toContain(connectedStatus.baseUrl);
  expect(container.textContent).toContain(connectedStatus.runnerId);
  expect(model.manage).toHaveBeenCalledExactlyOnceWith({
    environmentId: "local",
    input: { operation: "change-address", baseUrl },
  });
  await click("Cancel");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("blocks submission after the target environment loses manage permission and keeps cancellation available", async () => {
  await using _lifecycle = await setupLifecycle();
  await setStatus(connectedStatus);
  await click("Change address");
  const baseUrl = "https://replacement.example.test/convene";
  await enterUrl(baseUrl);
  await act(() => registry.set(permissionAtom("local"), false));
  expect(container.querySelector("input")!.disabled).toBe(true);
  const save = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Save",
  )!;
  expect(save.disabled).toBe(true);
  await act(() =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(model.manage).not.toHaveBeenCalled();
  expect(container.querySelector("input")!.value).toBe(baseUrl);
  expect(container.textContent).toContain(connectedStatus.baseUrl);
  await click("Cancel");
  const change = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Change address",
  )!;
  expect(change.disabled).toBe(true);
});

it("keeps saves on their original environment and ignores their late result in another environment's editor", async () => {
  await using _lifecycle = await setupLifecycle();
  await setStatus(connectedStatus);
  let finishSave!: (result: ManageResult) => void;
  model.manage.mockReturnValueOnce(
    new Promise<ManageResult>((resolve) => {
      finishSave = resolve;
    }),
  );
  const localUrl = "https://local.example.test/convene";
  await click("Change address");
  await enterUrl(localUrl);
  await click("Save");

  const remoteStatus = {
    ...connectedStatus,
    platformUrls: ["https://remote.example.test/"],
    baseUrl: "http://old-remote.example.test",
    runnerId: "remote-runner",
  };
  await setStatus(remoteStatus, "remote");
  await showEnvironment("remote");
  expect(container.querySelector("input")).toBeNull();
  expect(container.textContent).toContain(remoteStatus.baseUrl);
  expect(container.textContent).toContain(remoteStatus.runnerId);
  await click("Change address");
  expect(container.querySelector("input")!.value).toBe(remoteStatus.baseUrl);
  const remoteUrl = "https://remote.example.test/prefix";
  await enterUrl(remoteUrl);
  await act(() => finishSave(AsyncResult.success({ type: "status", status: connectedStatus })));
  expect(container.querySelector("input")!.value).toBe(remoteUrl);
  expect(container.textContent).toContain(remoteStatus.baseUrl);
  expect(container.textContent).not.toContain(connectedStatus.runnerId);

  model.manage.mockResolvedValueOnce(AsyncResult.success({ type: "status", status: remoteStatus }));
  await click("Save");
  expect(model.manage.mock.calls.map(([request]) => request)).toEqual([
    { environmentId: "local", input: { operation: "change-address", baseUrl: localUrl } },
    { environmentId: "remote", input: { operation: "change-address", baseUrl: remoteUrl } },
  ]);
  expect(container.querySelector("input")).toBeNull();
  expect(container.textContent).toContain(remoteStatus.baseUrl);
});

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

  await setStatus({ ...initialStatus, platformUrls: ["https://acceptance.example.test"] });
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

  await setStatus({ ...initialStatus, platformUrls: [] });
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
  const pairedStatus = {
    platformUrls: [],
    phase: "connecting",
    runnerId: "runner",
    baseUrl: "http://localhost",
    error: null,
  } satisfies ConveneStatus;
  model.manage.mockResolvedValueOnce(
    AsyncResult.success({
      type: "status",
      status: pairedStatus,
    }),
  );
  await advance(5000);
  await setStatus(pairedStatus);
  expect(container.textContent).toContain("Connecting to Convene");
  expect(container.textContent).toContain("Disconnect Convene");
  await advance(30000);
  expect(exchanges()).toHaveLength(2);
  await setStatus(initialStatus);
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
  registry = AtomRegistry.make();
  stack.defer(() => registry.dispose());
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  await changeLanguage("en");
  model.ttl = 30;
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
  // The panel has no router dependency; this fixture switches environments through its props.
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));
  await showEnvironment();

  stack.use(fakeTimers());
  renderStack = stack.move();
  return renderStack;
}
