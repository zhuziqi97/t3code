import "~/index.css";

import type { ClientSettings } from "@t3tools/contracts/settings";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

vi.mock("~/hooks/useSettings", async () => {
  const { DEFAULT_CLIENT_SETTINGS } = await import("@t3tools/contracts/settings");
  return {
    useEnvironmentIdentificationMode: () => "none",
    useClientSettings: (select: (settings: ClientSettings) => unknown) =>
      select(DEFAULT_CLIENT_SETTINGS),
  };
});
vi.mock("../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: () => null,
  useSidebarStageBackdropVariant: () => null,
}));

import { render } from "../../../test/render";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

it("opens implementation actions with a mouse while the composer is resting", async () => {
  const onImplementPlanInNewThread = vi.fn();
  await using _screen = await render(
    <ComposerPrimaryActions
      compact={false}
      canOperateThread
      pendingAction={null}
      isRunning={false}
      canInterrupt={false}
      showPlanFollowUpPrompt
      promptHasText={false}
      isSendBusy={false}
      sendDisabledReason={null}

      isEnvironmentUnavailable={false}
      isPreparingWorktree={false}
      hasSendableContent={false}
      preserveComposerFocusOnPointerDown
      onPreviousPendingQuestion={() => {}}
      onInterrupt={() => {}}
      onImplementPlanInNewThread={onImplementPlanInNewThread}
    />,
  );

  await userEvent.click(page.getByRole("button", { name: "Implementation actions" }));
  const item = page.getByRole("menuitem", { name: "Implement in a new thread" });
  await expect.element(item).toBeVisible();
  await userEvent.click(item);
  expect(onImplementPlanInNewThread).toHaveBeenCalledTimes(1);
});

function actionProps(
  overrides: Partial<React.ComponentProps<typeof ComposerPrimaryActions>> = {},
): React.ComponentProps<typeof ComposerPrimaryActions> {
  return {
    compact: false,
    canOperateThread: true,
    pendingAction: null,
    isRunning: false,
    canInterrupt: false,
    showPlanFollowUpPrompt: false,
    promptHasText: false,
    isSendBusy: false,
    sendDisabledReason: null,

    isEnvironmentUnavailable: false,
    isPreparingWorktree: false,
    hasSendableContent: false,
    onPreviousPendingQuestion: () => {},
    onInterrupt: () => {},
    onImplementPlanInNewThread: () => {},
    ...overrides,
  };
}

describe.each([true, false])("composer collapsed=%s", (collapsed) => {
  const layout = collapsed ? "collapsed" : "expanded";

  it.each(["running", "preparing"])(
    `${layout}: interrupts an empty %s turn without expanding or submitting`,
    async (phase) => {
      const onInterrupt = vi.fn();
      const onExpand = vi.fn();
      const onSubmit = vi.fn();
      const props = actionProps({
        compact: collapsed,
        isRunning: phase === "running",
        isPreparingWorktree: phase === "preparing",
        canInterrupt: true,
        // Sending is blocked during preparation; stopping must remain available.
        isSendBusy: phase === "preparing",

        sendDisabledReason: phase === "preparing" ? "Preparing worktree" : null,
        preserveComposerFocusOnPointerDown: true,
        onInterrupt,
        ...(collapsed ? { onExpandForCompaction: onExpand } : {}),
      });
      await using screen = await render(
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <input aria-label="Draft" />
          <ComposerPrimaryActions {...props} />
        </form>,
      );
      const input = screen.getByRole("textbox", { name: "Draft" });
      await userEvent.click(input);
      const stop = screen.getByRole("button", { name: "Stop generation", exact: true });
      await expect.element(stop).toBeEnabled();
      expect(stop.element().querySelector("svg rect")).not.toBeNull();
      await userEvent.click(stop);
      expect(onInterrupt).toHaveBeenCalledOnce();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onExpand).not.toHaveBeenCalled();
      await expect.element(input).toHaveFocus();
    },
  );

  it.each([
    { followUpBehavior: "steer", editing: false, label: "Steer message" },
    { followUpBehavior: "queue", editing: false, label: "Queue message" },
    { followUpBehavior: "queue", editing: true, label: "Update queued message" },
  ] as const)(
    `${layout}: keeps $label for a running draft`,
    async ({ followUpBehavior, editing, label }) => {
      const onInterrupt = vi.fn();
      const onSubmit = vi.fn();
      const props = actionProps({
        compact: collapsed,
        isRunning: true,
        canInterrupt: true,
        hasSendableContent: true,
        promptHasText: true,
        followUpBehavior,
        isEditingQueuedMessage: editing,
        onInterrupt,
        ...(collapsed ? { onExpandForCompaction: () => {} } : {}),
      });
      await using screen = await render(
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <ComposerPrimaryActions {...props} />
        </form>,
      );
      const send = screen.getByRole("button", { name: label, exact: true });
      await expect.element(send).toBeEnabled();
      expect(send.element().querySelector("svg rect")).toBeNull();
      await userEvent.click(send);
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onInterrupt).not.toHaveBeenCalled();
    },
  );

  it(`${layout}: switches from stop to resume and back to preparation`, async () => {
    const onInterrupt = vi.fn();
    const onResume = vi.fn();
    const props = actionProps({
      compact: collapsed,
      canInterrupt: true,
      onInterrupt,
      onResume,
      ...(collapsed ? { onExpandForCompaction: () => {} } : {}),
    });
    await using screen = await render(<ComposerPrimaryActions {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Stop generation", exact: true }));
    expect(onInterrupt).toHaveBeenCalledOnce();
    await screen.rerender(<ComposerPrimaryActions {...props} canInterrupt={false} canResume />);
    const resume = screen.getByRole("button", { name: "Resume thread", exact: true });
    await expect.element(resume).toBeEnabled();
    await userEvent.click(resume);
    expect(onResume).toHaveBeenCalledOnce();
    await screen.rerender(<ComposerPrimaryActions {...props} isPreparingWorktree isSendBusy />);
    await expect
      .element(screen.getByRole("button", { name: "Stop generation", exact: true }))
      .toBeEnabled();
  });

  it(`${layout}: does not stop while editing an empty queued message and respects operation permission`, async () => {
    const props = actionProps({
      compact: collapsed,
      isRunning: true,
      canInterrupt: true,
      isEditingQueuedMessage: true,
      ...(collapsed ? { onExpandForCompaction: () => {} } : {}),
    });
    await using screen = await render(<ComposerPrimaryActions {...props} />);
    await expect
      .element(screen.getByRole("button", { name: "Update queued message", exact: true }))
      .toBeDisabled();
    await screen.rerender(
      <ComposerPrimaryActions {...props} isEditingQueuedMessage={false} canOperateThread={false} />,
    );
    await expect
      .element(screen.getByRole("button", { name: "Stop generation", exact: true }))
      .toBeDisabled();
  });
});

it("opens a collapsed composer to confirm compaction without dispatching the draft", async () => {
  const onExpand = vi.fn();
  const onSubmit = vi.fn();
  const props = actionProps({
    compact: true,
    hasSendableContent: true,
    promptHasText: true,
    compactBeforeSendTokens: 12_000,
    onExpandForCompaction: onExpand,
  });
  await using screen = await render(
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <ComposerPrimaryActions {...props} />
    </form>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Open composer to compact and send", exact: true }),
  );
  expect(onExpand).toHaveBeenCalledOnce();
  expect(onSubmit).not.toHaveBeenCalled();
  await screen.rerender(
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <ComposerPrimaryActions {...props} keepFullHistory />
    </form>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Submit message", exact: true }));
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onExpand).toHaveBeenCalledOnce();
});
