import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../../test/render";
import { RuntimeRequestId } from "@t3tools/contracts";

import { expect, it, vi } from "vite-plus/test";
import { changeLanguage } from "../../i18n";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";

let root: Screen;
let container: HTMLDivElement;
const requestId = RuntimeRequestId.make("approval-1");
const respond = vi.fn().mockResolvedValue(undefined);

async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLElement>("button, [role=menuitem]")].find(
    (el) => el.textContent?.trim() === label || el.getAttribute("aria-label") === label,
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}

it("switches the default labels without remounting and sends the original decisions from both surfaces", async () => {
  await using _lifecycle = await setupLifecycle();

  await act(async () =>
    root.rerender(
      <ComposerPendingApprovalActions
        requestId={requestId}
        canRespond
        isResponding={false}
        onRespondToApproval={respond}
      />,
    ),
  );
  expect(container.textContent).toContain("Approve");
  expect(container.textContent).not.toContain("Always allow this session");
  await act(async () => {
    await changeLanguage("zh");
  });
  await click("允许");
  expect(respond).toHaveBeenLastCalledWith(requestId, "accept");
  await click("更多审批选项");
  await click("本会话始终允许");
  expect(respond).toHaveBeenLastCalledWith(requestId, "acceptForSession");
  await act(async () => {
    await changeLanguage("en");
  });
  await click("Decline");
  expect(respond).toHaveBeenLastCalledWith(requestId, "decline");
});

it("localizes known provider labels while preserving custom choices and warnings", async () => {
  await using _lifecycle = await setupLifecycle();

  const warning = "This application can access your browser data.";
  await changeLanguage("zh");
  await act(async () =>
    root.rerender(
      <ComposerPendingApprovalActions
        requestId={requestId}
        canRespond
        isResponding={false}
        options={[
          { decision: "accept", label: "Allow once", warning },
          { decision: "decline", label: "Deny" },
          { decision: "acceptAlways", label: "Always allow Safari" },
        ]}
        onRespondToApproval={respond}
      />,
    ),
  );
  const allow = [...container.querySelectorAll("button")].find((el) =>
    el.textContent?.includes("允许一次"),
  )!;
  expect(allow.getAttribute("aria-description")).toBe(warning);
  await click("允许一次");
  expect(respond).toHaveBeenLastCalledWith(requestId, "accept");
  await click("更多审批选项");
  await click("Always allow Safari");
  expect(respond).toHaveBeenLastCalledWith(requestId, "acceptAlways");
});

it.each([
  { canRespond: false, isResponding: false },
  { canRespond: true, isResponding: true },
])("keeps primary decisions disabled when a response is unavailable (%j)", async (state) => {
  await using _lifecycle = await setupLifecycle();

  await changeLanguage("zh");
  await act(async () =>
    root.rerender(
      <ComposerPendingApprovalActions
        requestId={requestId}
        {...state}
        onRespondToApproval={respond}
      />,
    ),
  );
  await click("允许");
  expect(respond).not.toHaveBeenCalled();
  const more = container.querySelector<HTMLButtonElement>('[aria-label="更多审批选项"]')!;
  expect(more.disabled).toBe(true);
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    await changeLanguage("en");
    vi.unstubAllGlobals();
  });

  vi.clearAllMocks();

  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));

  renderStack = stack.move();
  return renderStack;
}
