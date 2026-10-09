// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
const commands = vi.hoisted(() => ({
  listAcpRegistrySessions: vi.fn(),
  importAcpRegistrySession: vi.fn(),
  deleteAcpRegistrySession: vi.fn(),
  listAcpRegistryProviders: vi.fn(),
  setAcpRegistryProvider: vi.fn(),
  disableAcpRegistryProvider: vi.fn(),
  logoutAcpRegistry: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("../../state/server", () => ({ serverEnvironment: commands }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("~/state/session", () => ({
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({ dialogs: { confirm: commands.confirm } }),
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: commands.toast } }));
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
import { changeLanguage } from "../../i18n";
import { AcpSessionManagementSection } from "./AcpSessionManagementSection";
const environmentId = EnvironmentId.make("controlled-environment");
const instanceId = ProviderInstanceId.make("controlled-acp");
const projectId = ProjectId.make("controlled-project");
const session = {
  sessionId: "raw-session",
  title: "User native session",
  cwd: "/controlled/workspace",
  additionalDirectories: [],
  updatedAt: "2026-10-10T00:00:00Z",
  importedThreadId: null,
};
const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("acpRegistry"),
  enabled: true,
  installed: true,
  version: "controlled-version",
  status: "ready",
  auth: { status: "authenticated" },
  nativeSessions: { canList: true, canLoad: true, canResume: true, canDelete: true },
  configurableProviders: true,
  checkedAt: "2026-10-10T00:00:00Z",
  models: [],
  slashCommands: [],
  skills: [],
};
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  commands.listAcpRegistrySessions
    .mockReset()
    .mockResolvedValue({ _tag: "Success", value: { sessions: [session], nextCursor: null } });
  commands.listAcpRegistryProviders.mockReset().mockResolvedValue({
    _tag: "Success",
    value: {
      providers: [
        {
          providerId: "raw-provider",
          supported: ["openai"],
          required: false,
          current: { apiType: "openai", baseUrl: "https://controlled.example/v1" },
        },
      ],
    },
  });
  commands.setAcpRegistryProvider
    .mockReset()
    .mockResolvedValue({ _tag: "Success", value: { configured: true } });
  commands.importAcpRegistrySession.mockReset();
  commands.deleteAcpRegistrySession.mockReset();
  commands.confirm.mockReset().mockResolvedValue(false);
  commands.toast.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.unstubAllGlobals();
});
const render = async () =>
  act(async () =>
    root.render(
      <AcpSessionManagementSection
        environmentId={environmentId}
        instanceId={instanceId}
        provider={provider}
        projects={[{ id: projectId, title: "User project", workspaceRoot: session.cwd }]}
        readOnly={false}
      />,
    ),
  );
const button = (label: string) => {
  const node = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  expect(node, label).toBeDefined();
  return node!;
};
const click = async (node: HTMLElement) => act(async () => node.click());
const switchLanguage = async (language: "en" | "zh") => act(async () => changeLanguage(language));
const type = async (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const input = (label: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

it("preserves a native session during language changes and imports its original identifiers once", async () => {
  let resolve!: (value: unknown) => void;
  commands.importAcpRegistrySession.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await render();
  await click(button("List sessions"));
  await switchLanguage("zh");
  expect(container.textContent).toContain("User native session");
  await click(button("删除"));
  expect(commands.confirm).toHaveBeenCalledExactlyOnceWith(
    "永久删除原生 ACP 会话“User native session”？",
    { variant: "destructive" },
  );
  expect(commands.deleteAcpRegistrySession).not.toHaveBeenCalled();
  await click(button("导入"));
  expect(commands.importAcpRegistrySession).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: {
      instanceId,
      projectId,
      sessionId: session.sessionId,
      title: session.title,
      updatedAt: session.updatedAt,
    },
  });
  await switchLanguage("en");
  expect(container.textContent).toContain("Importing");
  await switchLanguage("zh");
  expect(container.textContent).toContain("正在导入");
  await act(async () =>
    resolve({ _tag: "Success", value: { imported: true, threadId: "controlled-thread" } }),
  );
  expect(button("已导入").disabled).toBe(true);
  expect(commands.importAcpRegistrySession).toHaveBeenCalledTimes(1);
  expect(commands.listAcpRegistrySessions).toHaveBeenCalledTimes(1);
});

it("keeps routing drafts, validates JSON in Chinese, and sends original headers and protocol", async () => {
  await render();
  await click(button("List providers"));
  await type(input("raw-provider base URL"), "https://controlled.example/changed");
  await type(input("raw-provider write-only headers JSON"), "{");
  await switchLanguage("zh");
  expect(input("raw-provider 基础 URL").value).toBe("https://controlled.example/changed");
  expect(input("raw-provider 仅可写入的请求头 JSON").value).toBe("{");
  expect(commands.listAcpRegistryProviders).toHaveBeenCalledTimes(1);
  await click(button("保存"));
  expect(commands.toast).toHaveBeenLastCalledWith({
    type: "error",
    title: "提供方请求头无效",
    description: "请求头必须为有效的 JSON。",
  });
  expect(commands.setAcpRegistryProvider).not.toHaveBeenCalled();
  await type(input("raw-provider 仅可写入的请求头 JSON"), '{"Authorization":"Bearer controlled"}');
  await switchLanguage("en");
  await click(button("Save"));
  expect(commands.setAcpRegistryProvider).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: {
      instanceId,
      projectId,
      providerId: "raw-provider",
      apiType: "openai",
      baseUrl: "https://controlled.example/changed",
      headers: { Authorization: "Bearer controlled" },
    },
  });
});
