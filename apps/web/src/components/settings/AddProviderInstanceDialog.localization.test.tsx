// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, type AcpRegistrySearchAgent } from "@t3tools/contracts";

const state = vi.hoisted(() => ({
  persist: vi.fn(),
  mutationFor: vi.fn(),
  prepare: vi.fn(),
  agents: [] as AcpRegistrySearchAgent[],
}));
vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: () => ({ providerInstances: {} }),
  usePersistEnvironmentProviderInstanceMutation: (id: EnvironmentId) => {
    state.mutationFor(id);
    return state.persist;
  },
}));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("../../state/server", () => ({
  EMPTY_SERVER_PROVIDERS: [],
  serverEnvironment: {
    searchAcpRegistry: () => "controlled-search",
    prepareAcpRegistryAgent: state.prepare,
  },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: { agents: state.agents },
    isPending: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("./settingsLayout", () => ({
  SettingsRow: ({
    title,
    description,
    status,
    control,
    children,
  }: {
    title: ReactNode;
    description: ReactNode;
    status: ReactNode;
    control: ReactNode;
    children: ReactNode;
  }) => (
    <section>
      {title}
      {description}
      {status}
      {control}
      {children}
    </section>
  ),
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: vi.fn() } }));
import { changeLanguage } from "../../i18n";
import { AddProviderInstanceDialog } from "./AddProviderInstanceDialog";
import { AcpRegistrySearchStep } from "./AcpRegistrySearchStep";

const environmentId = EnvironmentId.make("controlled-environment");
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.getAnimations = () => [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  await changeLanguage("en");
  state.persist.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  state.prepare.mockReset();
  state.mutationFor.mockClear();
  state.agents = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(Element.prototype, "getAnimations");
  await changeLanguage("en");
  vi.unstubAllGlobals();
});
const render = async (node: ReactNode) => act(async () => root.render(node));
const switchLanguage = async (language: "en" | "zh") => act(async () => changeLanguage(language));
const type = async (input: HTMLInputElement, value: string) =>
  act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const button = (label: string) => {
  const node = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  expect(node, label).toBeDefined();
  return node!;
};
const click = async (node: HTMLElement) => act(async () => node.click());
const input = (id: string) => document.getElementById(id) as HTMLInputElement;

it("keeps wizard identity and config drafts and creates the instance on the original environment", async () => {
  const onOpenChange = vi.fn();
  await render(
    <AddProviderInstanceDialog
      open
      environmentId={environmentId}
      environmentLabel="User host"
      onOpenChange={onOpenChange}
    />,
  );
  await click(button("Configure manually"));
  await type(input("add-provider-label"), "Work team");
  await type(input("add-provider-instance-id"), "invalid id");
  await click(button("Next"));
  expect(document.body.textContent).toContain("Instance ID must start with a letter");
  await switchLanguage("zh");
  expect(document.body.textContent).toContain("实例 ID 必须以字母开头");
  expect(input("add-provider-label").value).toBe("Work team");
  expect(input("add-provider-instance-id").value).toBe("invalid id");
  expect(state.persist).not.toHaveBeenCalled();
  await type(input("add-provider-instance-id"), "codex_work");
  await click(button("下一步"));
  await type(input("add-provider-codex-binaryPath"), "/controlled/codex");
  await act(async () =>
    input("add-provider-codex-binaryPath").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  await switchLanguage("en");
  expect(input("add-provider-codex-binaryPath").value).toBe("/controlled/codex");
  expect(state.persist).not.toHaveBeenCalled();
  await click(button("Add instance"));
  expect(state.persist).toHaveBeenCalledExactlyOnceWith({
    operation: "create",
    instanceId: "codex_work",
    instance: {
      driver: "codex",
      enabled: true,
      displayName: "Work team",
      config: { binaryPath: "/controlled/codex", setupMode: "existing" },
    },
  });
  expect(state.mutationFor.mock.calls.every(([id]) => id === environmentId)).toBe(true);
  expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
});

it("keeps a pending ACP preparation through language changes and returns the original agent data", async () => {
  const agent: AcpRegistrySearchAgent = {
    id: "raw-agent",
    name: "Original agent",
    version: "1.2.3",
    description: "Provider description",
    authors: [],
    license: "MIT",
    website: null,
    repository: null,
    icon: null,
    distribution: "npx",
    integrity: "registry",
  };
  state.agents = [agent];
  let resolve!: (value: unknown) => void;
  state.prepare.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const onPrepared = vi.fn();
  await render(
    <AcpRegistrySearchStep
      environmentId={environmentId}
      providerInstances={{}}
      onPrepared={onPrepared}
      onManualConfiguration={vi.fn()}
    />,
  );
  await click(button("Add"));
  expect(state.prepare).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { agentId: "raw-agent" },
  });
  await switchLanguage("zh");
  expect(container.textContent).toContain("正在准备");
  expect(container.textContent).toContain("Original agent");
  expect(container.textContent).toContain("Provider description");
  expect(onPrepared).not.toHaveBeenCalled();
  await act(async () =>
    resolve({
      _tag: "Success",
      value: { agentId: "raw-agent", version: "2.0.0", distribution: "binary", prepared: true },
    }),
  );
  expect(onPrepared).toHaveBeenCalledExactlyOnceWith({
    ...agent,
    version: "2.0.0",
    distribution: "binary",
  });
  expect(state.prepare).toHaveBeenCalledTimes(1);
});
