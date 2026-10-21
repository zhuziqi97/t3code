import "~/index.css";
import { page } from "vite-plus/test/browser";
import { act, render as renderTestUi, type Screen } from "../../../test/render";
import { EnvironmentId, ProjectId, type ConveneProjectConfiguration } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

import { expect, it, vi } from "vite-plus/test";

const model = vi.hoisted(() => ({
  status: vi.fn(),
  query: vi.fn(),
  mutate: vi.fn(),
  options: vi.fn(),
  commands: { query: {}, mutate: {}, options: {} },
}));
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<typeof import("@effect/atom-react")>()),
  useAtomValue: () => true,
}));
vi.mock("../../state/convene", async (original) => ({
  ...(await original<typeof import("../../state/convene")>()),
  conveneEnvironment: {
    queryProject: model.commands.query,
    mutateProject: { ...model.commands.mutate, permissionAtom: () => true },
    projectOptions: model.commands.options,
  },
}));
vi.mock("../../state/use-atom-command", async (original) => ({
  ...(await original<typeof import("../../state/use-atom-command")>()),
  useAtomCommand: (command: unknown) =>
    command === model.commands.query
      ? model.query
      : command === model.commands.options
        ? model.options
        : model.mutate,
}));
vi.mock("./ConveneConnectionPanel", async (original) => ({
  ...(await original<typeof import("./ConveneConnectionPanel")>()),
  useConveneStatus: () => model.status(),
  ConveneConnectionPanel: () => <div>Embedded connection form</div>,
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: ({
    to,
    search,
    children,
    ...props
  }: {
    to: string;
    search: { machine: string };
    children?: React.ReactNode;
  }) => (
    <a
      {...props}
      href={`${to}?machine=${search.machine}`}
      onClick={(event) => {
        (props as { onClick?: React.MouseEventHandler }).onClick?.(event);
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));
import { changeLanguage } from "../../i18n";
import { ConveneProjectSetup } from "./ConveneProjectPanel";

const configuration: ConveneProjectConfiguration = {
  runner_id: "runner",
  runner_name: "Computer",
  client_project_id: "client-project",
  project: { native_project_id: "project", display_name: "My project" },
  targets: [
    {
      target_id: "root",
      native_workspace_key: "root",
      path: "/project",
      workspace_display_name: "Root",
      branch: null,
      availability: "AVAILABLE",
    },
  ],
  bindings: [],
  mcp_enabled: false,
  mcp_scope_modules: [],
  mcp_capabilities: { code_graph_enabled: false, forge_enabled: false, issue_enabled: false },
  mcp_scope_details: [],
  binding_module_details: [],
};
let root: Screen;
let container: HTMLDivElement;
const done = vi.fn(),
  later = vi.fn();

async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === label || el.getAttribute("aria-label") === label,
  );
  expect(button, label).toBeDefined();
  if (["Convene MCP", "Module bindings"].includes(label)) {
    await page.getByRole("tab", { name: label, exact: true }).click();
  } else {
    await act(async () => button!.click());
  }
}
function selectAllCheckbox() {
  return [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].find(
    (el) => el.closest("label")?.textContent?.trim() === "Select all",
  )!;
}

async function enableMcp() {
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
}

it("starts with two uses, reveals MCP options on demand and saves before finishing", async () => {
  await using _lifecycle = await setupLifecycle();

  expect(container.textContent).toContain("Module bindings");
  expect(container.textContent).toContain("Convene MCP");
  await click("Convene MCP");
  await enableMcp();
  await click("Configure access scope");
  await click("Platform project");
  await act(async () => document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
  expect(document.body.textContent).toContain("Module A");
  await click("Confirm selection");
  expect(model.mutate).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Module A");
  model.mutate.mockResolvedValue(
    AsyncResult.success({
      ...configuration,
      mcp_enabled: true,
      mcp_scope_modules: [{ module_id: "module", permission: "READ" }],
    }),
  );
  await click("Save and finish");
  expect(model.mutate).toHaveBeenCalledWith({
    environmentId: "env",
    input: {
      operation: "save",
      projectId: "project",
      mcp_enabled: true,
      mcp_scope_modules: [{ module_id: "module", permission: "READ" }],
      mcp_capabilities: configuration.mcp_capabilities,
    },
  });
  expect(done).toHaveBeenCalledOnce();
});

it("keeps failed changes open and lets the user defer without claiming they were saved", async () => {
  await using _lifecycle = await setupLifecycle();

  await click("Convene MCP");
  await enableMcp();
  model.mutate.mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("platform down"))));
  await click("Save and finish");
  expect(done).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Could not update Convene");
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  expect(localStorage.length).toBeGreaterThan(0);
  await click("Set up later");
  expect(later).toHaveBeenCalledOnce();
  expect(done).not.toHaveBeenCalled();
});

it("adds a web execution module without enabling or granting MCP access", async () => {
  await using _lifecycle = await setupLifecycle();

  await click("Bind a module");
  await click("Platform project");
  model.mutate.mockResolvedValue(
    AsyncResult.success({
      ...configuration,
      bindings: [
        {
          binding_id: "binding",
          module_id: "module",
          runner_id: "runner",
          client_project_id: "client-project",
          target_id: null,
          status: "DISABLED",
        },
      ],
      binding_module_details: [
        {
          module_id: "module",
          module_name: "Module A",
          project_id: "platform-project",
          project_name: "Platform project",
          can_write: true,
        },
      ],
    }),
  );
  await click("Module A");
  expect(model.mutate).not.toHaveBeenCalled();
  await click("Bind module");
  expect(model.mutate).toHaveBeenCalledWith({
    environmentId: "env",
    input: { operation: "bind", projectId: "project", module_id: "module" },
  });
  await click("Convene MCP");
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  await expect
    .element(page.getByText("Platform project / Module A", { exact: false }))
    .not.toBeInTheDocument();
  await click("Module bindings");
  expect(container.textContent).toContain("Not used for web tasks");
  expect(
    [...container.querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === "Allow web execution",
    )?.disabled,
  ).toBe(true);
});

it("configures MCP while disabled and retains its draft when switching to bindings", async () => {
  await using _lifecycle = await setupLifecycle();

  await click("Convene MCP");
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  await click("Configure access scope");
  await act(async () => document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
  await click("Confirm selection");
  expect(container.textContent).toContain("Platform project / Module A");
  await click("Module bindings");
  expect(container.textContent).toContain("No bound modules.");
  await click("Convene MCP");
  expect(container.textContent).toContain("Platform project / Module A");
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  model.mutate.mockResolvedValue(
    AsyncResult.success({
      ...configuration,
      mcp_scope_modules: [{ module_id: "module", permission: "READ" }],
    }),
  );
  await click("Save and finish");
  expect(model.mutate).toHaveBeenCalledWith({
    environmentId: "env",
    input: expect.objectContaining({
      operation: "save",
      mcp_enabled: false,
      mcp_scope_modules: [{ module_id: "module", permission: "READ" }],
    }),
  });
  expect(done).toHaveBeenCalledOnce();
});

it("keeps cross-project MCP selections together and cancellation leaves the outer draft intact", async () => {
  await using _lifecycle = await setupLifecycle();

  model.options.mockImplementation(async ({ input }) =>
    AsyncResult.success({
      items: input.projectId
        ? [
            {
              id: input.projectId === "one" ? "a" : "b",
              name: input.projectId === "one" ? "Module A" : "Module B",
              display_name: null,
              path: "/",
              can_write: true,
            },
          ]
        : [
            { id: "one", name: "Project one", display_name: null, path: "/", can_write: true },
            { id: "two", name: "Project two", display_name: null, path: "/", can_write: true },
          ],
      total: input.projectId ? 1 : 2,
      truncated: false,
    }),
  );
  await click("Convene MCP");
  await click("Configure access scope");
  expect(document.querySelector('[aria-label="Access Module A"]')).not.toBeNull();
  await click("Project one");
  await click("Search");
  expect(document.querySelector('[aria-label="Access Module A"]')).not.toBeNull();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Access Module A"]')!.click(),
  );
  await click("Project two");
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Access Module B"]')!.click(),
  );
  expect(document.body.textContent).toContain("Project one / Module A");
  expect(document.body.textContent).toContain("Project two / Module B");
  await click("Confirm selection");
  expect(model.mutate).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Project two / Module B");
  await click("2 modules selected · Change");
  await click("Remove Project one / Module A");
  await click("Cancel");
  expect(container.textContent).toContain("Project one / Module A");
  expect(container.textContent).toContain("Project two / Module B");
  expect(model.mutate).not.toHaveBeenCalled();
});

it("allows read-only MCP access while excluding those modules from execution binding", async () => {
  await using _lifecycle = await setupLifecycle();

  model.options.mockImplementation(async ({ input }) =>
    AsyncResult.success({
      items: [
        {
          id: input.projectId ? "readonly-module" : "readonly-project",
          name: input.projectId ? "Read-only module" : "Read-only project",
          display_name: null,
          path: "/",
          can_write: false,
        },
      ],
      total: 1,
      truncated: false,
    }),
  );
  await click("Bind a module");
  const bindingButton = [...document.querySelectorAll("button")].find((el) =>
    el.textContent?.includes("Read-only module"),
  );
  expect(bindingButton?.disabled).toBe(true);
  expect(model.mutate).not.toHaveBeenCalled();
  await click("Cancel");
  await click("Convene MCP");
  await click("Configure access scope");
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Access Read-only module"]')!.click(),
  );
  await click("Confirm selection");
  expect(container.textContent).toContain("Read-only project / Read-only module");
  expect(container.textContent).toContain("Read");
  expect(model.mutate).not.toHaveBeenCalled();
});

it("selects all current modules and changes permissions without altering other projects or granting unavailable write access", async () => {
  await using _lifecycle = await setupLifecycle();

  model.options.mockImplementation(async ({ input }) =>
    AsyncResult.success({
      items: !input.projectId
        ? [
            { id: "one", name: "Project one", display_name: null, path: "/", can_write: true },
            { id: "two", name: "Project two", display_name: null, path: "/", can_write: true },
          ]
        : input.projectId === "one"
          ? [
              { id: "a", name: "Writable", display_name: null, path: "/", can_write: true },
              {
                id: "readonly",
                name: "Read-only",
                display_name: null,
                path: "/",
                can_write: false,
              },
            ]
          : [{ id: "b", name: "Module B", display_name: null, path: "/", can_write: true }],
      total: input.projectId === "two" ? 1 : 2,
      truncated: false,
    }),
  );
  await click("Convene MCP");
  await click("Configure access scope");
  await click("Project two");
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Access Module B"]')!.click(),
  );
  await click("Set selected modules to read and write");
  await click("Project one");
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Access Writable"]')!.click(),
  );
  await click("Set selected modules to read and write");
  expect(selectAllCheckbox()?.getAttribute("aria-checked")).toBe("mixed");
  await act(async () => selectAllCheckbox()!.click());
  expect(document.body.textContent).toContain("Project one / Writable · Read and write");
  expect(document.body.textContent).toContain("Project one / Read-only · Read");
  await click("Set selected modules to read and write");
  expect(document.body.textContent).toContain("Project one / Read-only · Read");
  expect(document.body.textContent).not.toContain("Project one / Read-only · Read and write");
  await click("Set selected modules to read");
  expect(document.body.textContent).toContain("Project two / Module B · Read and write");
  expect(document.body.textContent).toContain("Project one / Writable · Read");
  await act(async () => selectAllCheckbox()!.click());
  expect(
    document.querySelector('[aria-label="Access Writable"]')?.getAttribute("aria-checked"),
  ).toBe("false");
  await click("Confirm selection");
  expect(container.textContent).toContain("Project two / Module B · Read and write");
  expect(container.textContent).not.toContain("Project one / Writable");
  model.mutate.mockResolvedValue(
    AsyncResult.success({
      ...configuration,
      mcp_scope_modules: [{ module_id: "b", permission: "WRITE" }],
    }),
  );
  await click("Save and finish");
  expect(model.mutate).toHaveBeenCalledWith({
    environmentId: "env",
    input: expect.objectContaining({
      mcp_scope_modules: [{ module_id: "b", permission: "WRITE" }],
    }),
  });
  expect(done).toHaveBeenCalledOnce();
});

it("does not embed connection details while loading and routes offline users to settings", async () => {
  await using _lifecycle = await setupLifecycle();

  model.query.mockResolvedValue(
    AsyncResult.success({ configuration: null, fresh: false, error: null }),
  );
  const render = () =>
    root.rerender(
      <ConveneProjectSetup
        environmentId={EnvironmentId.make("env")}
        projectId={ProjectId.make("project")}
        onDone={done}
        onLater={later}
      />,
    );
  model.status.mockReturnValue(AsyncResult.initial());
  await act(async () => {
    await root.unmount();
    root = renderStack.use(await renderTestUi(null, { container: container, router: false }));
    await render();
  });
  expect(container.textContent).not.toContain("Embedded connection form");
  expect(container.querySelector("a")).toBeNull();
  model.status.mockReturnValue(AsyncResult.success({ phase: "online" }));
  await act(async () => render());
  expect(container.textContent).not.toContain("Embedded connection form");
  expect(container.querySelector("a")).toBeNull();
  model.status.mockReturnValue(AsyncResult.success({ phase: "unpaired" }));
  await act(async () => render());
  const link = container.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("/settings/convene?machine=env");
  expect(link.textContent).toBe("Open Convene connection settings");
  await act(async () => {
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  expect(done).toHaveBeenCalledOnce();
  expect(container.textContent).not.toContain("Embedded connection form");
});

it("filters modules and limits bulk selection to visible results without losing other selections", async () => {
  await using _lifecycle = await setupLifecycle();

  model.options.mockImplementation(async ({ input }) =>
    AsyncResult.success({
      items: input.projectId
        ? [
            { id: "alpha", name: "alpha", display_name: "Alpha service", can_write: true },
            { id: "beta", name: "beta", display_name: "Beta service", can_write: true },
          ]
        : [{ id: "platform-project", name: "Platform project", can_write: true }],
      total: input.projectId ? 2 : 1,
      truncated: false,
    }),
  );
  await click("Convene MCP");
  await click("Configure access scope");
  await click("Platform project");
  const search = document.querySelector<HTMLInputElement>('input[aria-label="Search modules"]')!;
  const filter = async (value: string) =>
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        search,
        value,
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await filter("alpha");
  expect(document.querySelector('[aria-label="Access Beta service"]')).toBeNull();
  await act(async () => selectAllCheckbox().click());
  await filter("beta");
  expect(selectAllCheckbox().getAttribute("aria-checked")).toBe("false");
  await act(async () => selectAllCheckbox().click());
  await filter("");
  expect(selectAllCheckbox().getAttribute("aria-checked")).toBe("true");
  await click("Confirm selection");
  expect(container.textContent).toContain("Platform project / Alpha service");
  expect(container.textContent).toContain("Platform project / Beta service");
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  localStorage.clear();
  model.status.mockReturnValue(
    AsyncResult.success({
      phase: "online",
      runnerId: "runner",
      baseUrl: "http://local",
      error: null,
    }),
  );
  done.mockReset();
  later.mockReset();
  model.query
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ configuration, fresh: true, error: null }));
  model.mutate.mockReset();
  model.options.mockReset().mockImplementation(async ({ input }) =>
    AsyncResult.success({
      items: [
        {
          id: input.projectId ? "module" : "platform-project",
          name: input.projectId ? "Module A" : "Platform project",
          display_name: null,
          path: "/project",
          can_write: true,
        },
      ],
      total: 1,
      truncated: false,
    }),
  );
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));
  await act(async () =>
    root.rerender(
      <ConveneProjectSetup
        environmentId={EnvironmentId.make("env")}
        projectId={ProjectId.make("project")}
        onDone={done}
        onLater={later}
      />,
    ),
  );

  renderStack = stack.move();
  return renderStack;
}
