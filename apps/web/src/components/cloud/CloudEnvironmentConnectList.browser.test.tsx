import "~/index.css";
import { act, render } from "../../../test/render";
import { changeLanguage } from "../../i18n";
import { toastManager } from "../ui/toast";

import { type Discovery } from "@t3tools/client-runtime/relay";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, ORCHESTRATION_PROTOCOL_VERSION } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useState, type ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { fakeTimers } from "../../../test/render";

vi.mock(import("../ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: discovery.toast } };
});

type DiscoveredEnvironments = Discovery.RelayEnvironmentDiscoveryState["environments"];

const discovery = vi.hoisted(() => ({
  state: null as Discovery.RelayEnvironmentDiscoveryState | null,
  listeners: new Set<() => void>(),
  refresh: vi.fn<() => Promise<AtomCommandResult<void, never>>>(),
  register: vi.fn(),
  listEnvironments: vi.fn<() => Promise<DiscoveredEnvironments>>(),
  toast: vi.fn(),
}));

vi.mock(import("~/state/use-atom-command"), async (original) => {
  const { relayEnvironmentDiscovery } = await import("~/state/relay");
  return {
    ...(await original()),
    useAtomCommand: ((command: unknown) =>
      command === relayEnvironmentDiscovery.refresh
        ? discovery.refresh
        : discovery.register) as never,
  };
});
vi.mock(import("~/state/environments"), async (original) => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    discovery.listeners.add(listener);
    return () => discovery.listeners.delete(listener);
  };
  const read = () => {
    if (discovery.state === null) throw new Error("Discovery fixture is not initialized");
    return discovery.state;
  };
  return {
    ...(await original()),
    useRelayEnvironmentDiscovery: () => useSyncExternalStore(subscribe, read, read),
  };
});

import { CloudEnvironmentConnectRows } from "./CloudEnvironmentConnectList";

const newMachineId = EnvironmentId.make("new-computer");
const linkedMachines: DiscoveredEnvironments = new Map([
  [
    newMachineId,
    {
      environment: {
        environmentId: newMachineId,
        label: "Work laptop",
        endpoint: {
          httpBaseUrl: "https://relay.example.test",
          wsBaseUrl: "wss://relay.example.test/ws",
          providerKind: "manual",
        },
        linkedAt: "2026-09-05T12:00:00.000Z",
      },
      availability: "online",
      status: Option.none(),
      error: Option.none(),
    },
  ],
]);

let container: HTMLDivElement;
let visibility: DocumentVisibilityState;

function publish(state: Discovery.RelayEnvironmentDiscoveryState) {
  discovery.state = state;
  for (const listener of discovery.listeners) listener();
}

const renderRows = (element: ReactElement) => render(element, { container });

function mount(refreshWhileEmpty = true) {
  return renderRows(
    <CloudEnvironmentConnectRows
      primaryEnvironmentId={null}
      savedEnvironments={[]}
      showSavedEnvironments
      refreshWhileEmpty={refreshWhileEmpty}
      empty={<p>Waiting for your computer to connect.</p>}
    />,
  );
}

const text = () => container.textContent ?? "";
const button = () =>
  [...container.querySelectorAll("button")].find((element) => element.textContent !== "");
const checkbox = () => container.querySelector<HTMLElement>('[role="checkbox"]')!;
const checked = () => checkbox().getAttribute("aria-checked") === "true";
const toggle = async () => await act(async () => checkbox().click());
function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function setup() {
  using stack = new DisposableStack();
  stack.use(fakeTimers());
  visibility = "visible";
  stack.use(vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility));
  container = document.createElement("div");
  discovery.toast.mockReset();
  discovery.listeners.clear();
  discovery.state = {
    environments: new Map(),
    refreshing: false,
    offline: false,
    error: Option.none(),
  };
  discovery.listEnvironments.mockReset().mockResolvedValue(new Map());
  discovery.register.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  discovery.refresh.mockReset().mockImplementation(async () => {
    publish({ environments: new Map(), refreshing: true, offline: false, error: Option.none() });
    const environments = await discovery.listEnvironments();
    publish({ environments, refreshing: false, offline: false, error: Option.none() });
    return AsyncResult.success(undefined);
  });
  return stack.move();
}

describe("cloud environment offline reasons", () => {
  it("tells the user to update a computer whose idle tunnel was removed", async () => {
    await using _lifecycle = await setupLifecycle();

    using _environment = setup();
    const base = linkedMachines.get(newMachineId)!;
    const offlineEntry = (offlineReason?: "tunnel_released") => ({
      ...base,
      availability: "offline" as const,
      status: Option.some({
        environmentId: newMachineId,
        endpoint: base.environment.endpoint,
        status: "offline" as const,
        checkedAt: "2026-09-15T00:00:00Z",
        error: "Managed endpoint health request failed.",
        ...(offlineReason ? { offlineReason } : {}),
      }),
    });

    discovery.listEnvironments.mockResolvedValue(new Map([[newMachineId, offlineEntry()]]));
    await using _screen = await mount();
    expect(text()).toContain("T3 Connect · Not added · Relay offline");

    await act(async () => {
      publish({
        environments: new Map([[newMachineId, offlineEntry("tunnel_released")]]),
        refreshing: false,
        offline: false,
        error: Option.none(),
      });
    });
    expect(text()).toContain("T3 Connect tunnel was removed");
  });
});

describe("cloud onboarding discovery", () => {
  it("signals that the section can expand after initial discovery settles", async () => {
    await using _lifecycle = await setupLifecycle();

    using _environment = setup();
    let finishDiscovery!: (environments: DiscoveredEnvironments) => void;
    discovery.listEnvironments.mockReturnValue(
      new Promise((resolve) => {
        finishDiscovery = resolve;
      }),
    );
    const onDiscoveryReady = vi.fn();
    await using _screen = await renderRows(
      <CloudEnvironmentConnectRows
        primaryEnvironmentId={null}
        savedEnvironments={[]}
        onDiscoveryReady={onDiscoveryReady}
      />,
    );
    expect(onDiscoveryReady).not.toHaveBeenCalled();
    await act(async () => {
      finishDiscovery(linkedMachines);
    });
    expect(onDiscoveryReady).toHaveBeenCalledTimes(1);
    expect(button()?.textContent).toBe("Add");
  });

  it("keeps incompatible discoveries unselected until the user enables a compatible server", async () => {
    await using _lifecycle = await setupLifecycle();

    using _environment = setup();
    const base = linkedMachines.get(newMachineId)!;
    const entry = (protocolVersion: number) => ({
      ...base,
      status: Option.some({
        environmentId: newMachineId,
        endpoint: base.environment.endpoint,
        status: "online" as const,
        checkedAt: "2026-09-15T00:00:00Z",
        descriptor: {
          environmentId: newMachineId,
          label: base.environment.label,
          platform: { os: "linux" as const, arch: "x64" as const },
          serverVersion: "1.0.0",
          orchestrationProtocolVersion: protocolVersion,
          capabilities: { repositoryIdentity: true },
        },
      }),
    });
    discovery.listEnvironments.mockResolvedValue(
      new Map([[newMachineId, entry(ORCHESTRATION_PROTOCOL_VERSION + 1)]]),
    );
    const onSelectionChange = vi.fn();
    const autoSelectedComputers = new Set<EnvironmentId>();
    function Setup() {
      const [selectedIds, setSelectedIds] = useState<ReadonlySet<EnvironmentId>>(
        new Set([newMachineId]),
      );
      return (
        <CloudEnvironmentConnectRows
          primaryEnvironmentId={null}
          savedEnvironments={[]}
          showSavedEnvironments
          selection={{
            autoSelectedComputers,
            selectedIds,
            onChange: (id, checked) => {
              onSelectionChange(id, checked);
              setSelectedIds((current) => {
                const next = new Set(current);
                if (checked) next.add(id);
                else next.delete(id);
                return next;
              });
            },
          }}
        />
      );
    }
    await using _screen = await renderRows(<Setup />);
    expect(discovery.register).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenCalledWith(newMachineId, false);
    expect(checked()).toBe(false);
    expect(checkbox().hasAttribute("data-disabled")).toBe(true);
    expect(text()).toContain("Client not supported");
    expect(text()).toContain("Update your app");
    await toggle();
    expect(discovery.register).not.toHaveBeenCalled();
    await act(async () =>
      publish({
        ...discovery.state!,
        environments: new Map([[newMachineId, entry(ORCHESTRATION_PROTOCOL_VERSION)]]),
      }),
    );
    expect(discovery.register).not.toHaveBeenCalled();
    expect(checked()).toBe(false);
    expect(checkbox().hasAttribute("data-disabled")).toBe(false);
    await toggle();
    expect(discovery.register).toHaveBeenCalledTimes(1);
  });

  it("connects and selects discovered computers by default without overwriting deselection", async () => {
    await using _lifecycle = await setupLifecycle();

    using _environment = setup();
    discovery.listEnvironments.mockResolvedValue(linkedMachines);
    const autoSelectedComputers = new Set<EnvironmentId>();
    function Setup() {
      const [selectedIds, setSelectedIds] = useState<ReadonlySet<EnvironmentId>>(new Set());
      return (
        <CloudEnvironmentConnectRows
          primaryEnvironmentId={null}
          savedEnvironments={[]}
          showSavedEnvironments
          selection={{
            autoSelectedComputers,
            selectedIds,
            onChange: (id, checked) =>
              setSelectedIds((current) => {
                const next = new Set(current);
                if (checked) next.add(id);
                else next.delete(id);
                return next;
              }),
          }}
        />
      );
    }
    await using _screen = await renderRows(<Setup />);

    expect(discovery.register).toHaveBeenCalledTimes(1);
    expect(checked()).toBe(true);
    await toggle();
    await act(async () => {
      publish({ ...discovery.state!, environments: new Map(linkedMachines) });
    });
    expect(checked()).toBe(false);
    expect(discovery.register).toHaveBeenCalledTimes(1);
  });

  it("shows a newly linked computer without remounting and stops polling once found", async () => {
    await using _lifecycle = await setupLifecycle();

    using _environment = setup();
    discovery.listEnvironments
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(linkedMachines);
    await using _screen = await mount();
    expect(text()).toBe("Waiting for your computer to connect.");

    await advance(5_000);

    expect(text()).toContain("Work laptop");
    expect(button()?.textContent).toBe("Add");
    await advance(30_000);
    expect(discovery.listEnvironments).toHaveBeenCalledTimes(2);
  });

  it("keeps a discovered computer visible when it is added to the browser", async () => {
    await using _lifecycle = await setupLifecycle();

    using _environment = setup();
    discovery.listEnvironments.mockResolvedValue(linkedMachines);
    await using screen = await mount();
    expect(button()?.textContent).toBe("Add");
    await screen.rerender(
      <CloudEnvironmentConnectRows
        primaryEnvironmentId={null}
        savedEnvironments={[
          {
            environmentId: newMachineId,
            connection: { phase: "connected", error: null, traceId: null },
            relayManaged: true,
          },
        ]}
        showSavedEnvironments
        refreshWhileEmpty
      />,
    );
    expect(text()).toContain("Work laptop");
    expect(button()?.textContent).toBe("Connected");
  });

  it("waits while hidden and refreshes immediately when visible again", async () => {
    await using _lifecycle = await setupLifecycle();

    using _environment = setup();
    visibility = "hidden";
    await using _screen = await mount();
    await advance(30_000);
    expect(discovery.listEnvironments).not.toHaveBeenCalled();

    await act(async () => setVisibility("visible"));
    expect(discovery.listEnvironments).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    window.dispatchEvent(new Event("focus"));
    await advance(30_000);
    expect(discovery.listEnvironments).toHaveBeenCalledTimes(1);
  });

  it("does not overlap a slow refresh or restart polling after unmount", async () => {
    await using _lifecycle = await setupLifecycle();

    using _environment = setup();
    let resolveRefresh!: (environments: DiscoveredEnvironments) => void;
    const pending = new Promise<DiscoveredEnvironments>((resolve) => {
      resolveRefresh = resolve;
    });
    discovery.listEnvironments.mockResolvedValueOnce(new Map()).mockReturnValueOnce(pending);
    await using screen = await mount();
    await advance(5_000);
    expect(text()).toBe("Waiting for your computer to connect.");

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await advance(30_000);
    expect(discovery.listEnvironments).toHaveBeenCalledTimes(2);

    await screen.unmount();
    await act(async () => resolveRefresh(new Map()));
    await advance(30_000);
    expect(discovery.listEnvironments).toHaveBeenCalledTimes(2);
  });

  it("pauses while offline and resumes when discovery is online", async () => {
    await using _lifecycle = await setupLifecycle();

    using _environment = setup();
    await using _screen = await mount();
    await act(async () => publish({ ...discovery.state!, offline: true }));
    await advance(30_000);
    expect(discovery.listEnvironments).toHaveBeenCalledTimes(1);

    await act(async () => publish({ ...discovery.state!, offline: false }));
    await advance(5_000);
    expect(discovery.listEnvironments).toHaveBeenCalledTimes(2);
  });

  it("does not add polling to other cloud lists", async () => {
    await using _lifecycle = await setupLifecycle();

    using _environment = setup();
    await using _screen = await mount(false);
    await advance(30_000);
    expect(discovery.listEnvironments).toHaveBeenCalledTimes(1);
  });
});

it("updates discovery and offline guidance when language changes without adding a computer", async () => {
  await using _lifecycle = await setupLifecycle();

  using _environment = setup();
  discovery.listEnvironments.mockResolvedValue(linkedMachines);
  await using _screen = await mount(false);
  const rowText = () => text();
  expect(rowText()).toContain("T3 Connect · Not added · Relay online");
  await act(async () => changeLanguage("zh"));
  expect(rowText()).toContain("T3 Connect · 尚未添加 · 中继在线");
  expect(rowText()).toContain("Work laptop");
  await act(async () =>
    publish({ environments: new Map(), refreshing: false, offline: true, error: Option.none() }),
  );
  expect(rowText()).toContain("你似乎已离线。");
  expect(discovery.register).not.toHaveBeenCalled();
});

it("uses the completion language for an add started before switching languages", async () => {
  await using _lifecycle = await setupLifecycle();

  using _environment = setup();
  discovery.listEnvironments.mockResolvedValue(linkedMachines);
  let finish!: (result: AtomCommandResult<void, never>) => void;
  discovery.register.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await using _screen = await mount(false);
  const add = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Add",
  )!;
  await act(async () => {
    add.click();
  });
  expect(discovery.register).toHaveBeenCalledOnce();
  expect(toastManager.add).not.toHaveBeenCalled();
  await act(async () => changeLanguage("zh"));
  await act(async () => finish(AsyncResult.success(undefined)));
  expect(toastManager.add).toHaveBeenCalledWith({
    type: "success",
    title: "已添加执行环境",
    description: "正在通过 T3 Connect 连接 Work laptop。",
  });
  expect(discovery.register).toHaveBeenCalledOnce();
});

async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  stack.defer(async () => {
    await changeLanguage("en");
  });

  return stack.move();
}
