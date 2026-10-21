import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../test/render";
vi.mock("~/hooks/useSettings", async (original) => ({
  ...(await original<typeof import("~/hooks/useSettings")>()),
  useClientSettings: () => undefined,
}));
import { i18n } from "../i18n";
import { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { StrictMode, type ReactNode } from "react";

import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/state/session", async (original) => ({
  ...(await original<typeof import("~/state/session")>()),
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock("./ui/dialog", async (original) => ({
  ...(await original<typeof import("./ui/dialog")>()),
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  DialogDescription: "p",
  DialogFooter: "footer",
  DialogHeader: "header",
  DialogPanel: "section",
  DialogPopup: "section",
  DialogTitle: "h2",
}));
vi.mock("./ui/alert-dialog", async (original) => ({
  ...(await original<typeof import("./ui/alert-dialog")>()),
  AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? children : null,
  AlertDialogClose: "button",
  AlertDialogDescription: "p",
  AlertDialogFooter: "footer",
  AlertDialogHeader: "header",
  AlertDialogPopup: "section",
  AlertDialogTitle: "h2",
}));
vi.mock("./ui/button", async (original) => ({
  ...(await original<typeof import("./ui/button")>()),
  Button: "button",
}));
vi.mock("./ui/input", async (original) => ({
  ...(await original<typeof import("./ui/input")>()),
  Input: "input",
}));
vi.mock("./ui/label", async (original) => ({
  ...(await original<typeof import("./ui/label")>()),
  Label: "label",
}));
vi.mock("./ui/popover", async (original) => ({
  ...(await original<typeof import("./ui/popover")>()),
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverPopup: () => null,
  PopoverTrigger: "button",
}));
vi.mock("./ui/switch", async (original) => ({
  ...(await original<typeof import("./ui/switch")>()),
  Switch: "input",
}));
vi.mock("./ui/textarea", async (original) => ({
  ...(await original<typeof import("./ui/textarea")>()),
  Textarea: "textarea",
}));

import {
  EMPTY_PROJECT_SCRIPT_INPUT,
  ProjectScriptEditorDialog,
  type ProjectScriptEditorRequest,
} from "./projectScriptEditor";

const onSubmit = vi.fn<Parameters<typeof ProjectScriptEditorDialog>[0]["onSubmit"]>();
const onClose = vi.fn();
const onDelete = vi.fn();
let root: Screen;
let container: HTMLDivElement;

function request(name: string, error?: string): ProjectScriptEditorRequest {
  return {
    scriptId: name,
    initial: { ...EMPTY_PROJECT_SCRIPT_INPUT, name, command: `run-${name}` },
    ...(error === undefined ? {} : { error }),
  };
}

function editor(nextRequest: ProjectScriptEditorRequest) {
  return (
    <StrictMode>
      <ProjectScriptEditorDialog
        environmentId={EnvironmentId.make("test")}
        request={nextRequest}
        scripts={[]}
        onSubmit={onSubmit}
        onClose={onClose}
        onDelete={onDelete}
      />
    </StrictMode>
  );
}

async function open(nextRequest: ProjectScriptEditorRequest) {
  await act(async () => {
    await root.rerender(editor(nextRequest));
  });
}

function submit() {
  container
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function saveButton() {
  return container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
}

describe("project action editor language switching", () => {
  it("keeps the user's command and form values when switching to Chinese and saving", async () => {
    await using _lifecycle = await setupLifecycle();

    onSubmit.mockResolvedValue(AsyncResult.success(undefined));
    await open(request("build"));
    await act(() => {
      const name = container.querySelector<HTMLInputElement>("#script-name")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        name,
        "部署 API",
      );
      name.dispatchEvent(new Event("input", { bubbles: true }));
      const command = container.querySelector<HTMLTextAreaElement>("#script-command")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        command,
        "bun run build --filter api",
      );
      command.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await i18n.changeLanguage("zh");
    });
    expect(saveButton().textContent).toContain("保存更改");
    expect(container.querySelector<HTMLTextAreaElement>("#script-command")!.value).toBe(
      "bun run build --filter api",
    );
    await act(async () => {
      await submit();
    });
    expect(onSubmit).toHaveBeenCalledWith(
      "build",
      expect.objectContaining({ name: "部署 API", command: "bun run build --filter api" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    await i18n.changeLanguage("en");
    vi.unstubAllGlobals();
  });

  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));

  onSubmit.mockReset();
  onClose.mockReset();
  onDelete.mockReset();

  renderStack = stack.move();
  return renderStack;
}
