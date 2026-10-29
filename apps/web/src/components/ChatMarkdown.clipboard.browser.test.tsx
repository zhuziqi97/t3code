import {
  AVAILABLE_CONNECTION_STATE,
  EnvironmentSupervisor,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "@t3tools/client-runtime/connection";
import {
  RpcPermissionGuard,
  type RpcSession,
  type WsRpcProtocolClient,
} from "@t3tools/client-runtime/rpc";
import { createRuntimeCommand } from "@t3tools/client-runtime/state/runtime";
import { startThreadTurn } from "@t3tools/client-runtime/operations";
import {
  CommandId,
  EnvironmentId,
  type ComposerContextClipboardFragment,
  type OrchestrationMessageContext,
  type ThreadContextRecord,
  MessageId,
  ORCHESTRATION_V2_WS_METHODS,
  ThreadId,
  type OrchestrationV2Command,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Crypto from "effect/Crypto";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Layer from "effect/Layer";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { createRef, useState, type ComponentProps, type ReactNode } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  decodeComposerContextClipboardHtml,
  decodeComposerContextFragment,
} from "@t3tools/shared/composerContextClipboard";
import {
  formatComposerContextReference,
  threadContextRecord,
} from "@t3tools/shared/composerContextReferences";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../test/render";
import "../index.css";

const { query, request } = vi.hoisted(() => ({ query: vi.fn(), request: vi.fn() }));
vi.mock(import("../state/use-atom-query-runner"), async (original) => ({
  ...(await original()),
  useAtomQueryRunner: (() => query) as never,
}));
vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const noConfig = Atom.make(null);
  return {
    ...actual,
    serverEnvironment: { ...actual.serverEnvironment, configValueAtom: (() => noConfig) as never },
  };
});
vi.mock(import("../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => false,
  readEnvironmentScope: () => false,
}));
vi.mock(import("../remoteOpen"), async (original) => ({
  ...(await original()),
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }) as never,
}));
vi.mock(import("./chat/MermaidDiagram"), async (original) => ({
  ...(await original()),
  MermaidDiagram: () => <svg role="img" aria-label="Example diagram" />,
}));

import ChatMarkdown from "./ChatMarkdown";
import {
  ComposerPromptEditorTiptap as ComposerPromptEditor,
  type ComposerPromptEditorHandle,
  type ComposerPromptEditorProps,
} from "./ComposerPromptEditorTiptap";
import { submitComposerDraft } from "./chat/composerSubmission";
import { MessagesTimeline } from "./chat/MessagesTimeline";
import { asKnownContextRecord, buildMessageContext } from "../lib/composerContextRecords";

function setup() {
  query.mockReset().mockResolvedValue(AsyncResult.success({ entries: [] }));
  request.mockReset().mockImplementation(() => Effect.succeed({ sequence: 1 }));
}

function mockSender(messageContext?: () => OrchestrationMessageContext | undefined) {
  const registry = AtomRegistry.make();
  const command = createRuntimeCommand(
    Atom.runtime(
      Layer.mergeAll(
        Layer.effect(
          EnvironmentSupervisor.EnvironmentSupervisor,
          Effect.gen(function* () {
            const session: RpcSession = {
              client: {
                [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: (input: OrchestrationV2Command) =>
                  request(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, input),
              } as unknown as WsRpcProtocolClient,
              initialConfig: Effect.die("A start dispatch does not need server configuration"),
              subscribeServerConfig: () => Stream.never,
              ready: Effect.void,
              probe: Effect.void,
              inboundFrames: Effect.succeed(0),
              closed: Effect.never,
            };
            return EnvironmentSupervisor.EnvironmentSupervisor.of({
              target: new PrimaryConnectionTarget({
                environmentId: EnvironmentId.make("clipboard-environment"),
                label: "Clipboard mock",
                httpBaseUrl: "https://clipboard.example",
                wsBaseUrl: "wss://clipboard.example",
              }),
              state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
              session: yield* SubscriptionRef.make(Option.some(session)),
              prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
              connect: Effect.void,
              disconnect: Effect.void,
              retryNow: Effect.void,
            });
          }),
        ),
        Layer.succeed(RpcPermissionGuard, { authorize: () => Effect.void }),
        Layer.succeed(
          Crypto.Crypto,
          Crypto.make({
            randomBytes: (size) => new Uint8Array(size),
            digest: () => Effect.die("No digest is needed for a clipboard dispatch"),
          }),
        ),
      ),
    ),
    {
      label: "TestClipboard.send",
      execute: (text: string) =>
        startThreadTurn({
          commandId: CommandId.make("clipboard-example"),
          threadId: ThreadId.make("public-example"),
          dispatchMode: "start",
          message: {
            messageId: MessageId.make("copied-example"),
            role: "user",
            text,
            attachments: [],
            ...(messageContext?.() ? { context: messageContext()! } : {}),
          },
          runtimeMode: "full-access",
          interactionMode: "default",
        }),
    },
  );
  return {
    send: (text: string) =>
      command.run(registry, text).then((result) => {
        expect(result._tag).toBe("Success");
      }),
    [Symbol.dispose]: () => registry.dispose(),
  };
}

function Conversation({
  source,
  richText,
  send,
  onSent,
  renderReply,
  renderSent,
  contextRecords,
  importContextFragment,
}: {
  source: string;
  richText: boolean;
  send: (text: string) => Promise<void>;
  onSent: (pending: Promise<void>) => void;
  renderReply?: ((text: string) => ReactNode) | undefined;
  renderSent?: ((text: string) => ReactNode) | undefined;
  contextRecords?: ComposerPromptEditorProps["contextRecords"] | undefined;
  importContextFragment?: ComposerPromptEditorProps["importContextFragment"] | undefined;
}) {
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const editorRef = createRef<ComposerPromptEditorHandle>();
  const [emptyContextRecords] = useState(() => new Map());
  return (
    <>
      <section data-testid="reply">
        {renderReply ? (
          renderReply(source)
        ) : (
          <ChatMarkdown cwd="/tmp/public-example" text={source} />
        )}
      </section>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = editorRef.current!.readSnapshot().value;
          submitComposerDraft({
            prompt: value,
            event,
            submissionTarget: "provider-turn",
            onSend: () => {
              onSent(
                send(value).then(() => {
                  setSent(value);
                }),
              );
            },
          });
        }}
      >
        <ComposerPromptEditor
          editorRef={editorRef}
          value={draft}
          cursor={draft.length}
          richTextEnabled={richText}
          contextRecords={contextRecords ?? emptyContextRecords}
          importContextFragment={importContextFragment}
          skills={[]}
          disabled={false}
          placeholder="Paste here"
          onChange={setDraft}
          onPaste={() => {}}
        />
        <output data-testid="draft">{draft}</output>
        <button type="submit">Send copied draft</button>
      </form>
      {sent !== null ? (
        <section data-testid="sent">
          {renderSent ? renderSent(sent) : <ChatMarkdown cwd="/tmp/public-example" text={sent} />}
        </section>
      ) : null}
    </>
  );
}

function textPoint(element: Element, offset: number): [Node, number] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let remaining = offset;
  while ((node = walker.nextNode())) {
    const length = node.textContent!.length;
    if (remaining <= length) return [node, remaining];
    remaining -= length;
  }
  throw new Error(`Missing rendered text at ${offset}`);
}

function selectRange(start: [Node, number], end: [Node, number]) {
  const range = document.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  return range;
}

async function copyRange(target: Element, range: Range) {
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  const clipboardData = new DataTransfer();
  try {
    await act(() => {
      const event = new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });
  } finally {
    selection.removeAllRanges();
  }
  return clipboardData;
}

const linkCases = [
  {
    name: "inside label",
    selected: "guide",
    expected: "[guide](https://docs.example/guide)",
    links: [["guide", "https://docs.example/guide"]],
  },
  {
    name: "inside Issue label",
    selected: "18",
    expected: "[18](http://convene.example/issues/18)",
    links: [["18", "http://convene.example/issues/18"]],
  },
  {
    name: "whole label",
    selected: "release guide",
    expected: "[release guide](https://docs.example/guide)",
    links: [["release guide", "https://docs.example/guide"]],
  },
  {
    name: "whole anchor",
    selected: "release guide",
    expected: "[release guide](https://docs.example/guide)",
    links: [["release guide", "https://docs.example/guide"]],
  },
  {
    name: "paragraph",
    selected: "Read release guide and issue 18 next.",
    expected:
      "Read [release guide](https://docs.example/guide) and [issue 18](http://convene.example/issues/18) next.",
    links: [
      ["release guide", "https://docs.example/guide"],
      ["issue 18", "http://convene.example/issues/18"],
    ],
  },
  {
    name: "from link",
    selected: "guide and issue 18 next.",
    expected:
      "[guide](https://docs.example/guide) and [issue 18](http://convene.example/issues/18) next.",
    links: [
      ["guide", "https://docs.example/guide"],
      ["issue 18", "http://convene.example/issues/18"],
    ],
  },
  {
    name: "into link",
    selected: "Read release",
    expected: "Read [release](https://docs.example/guide)",
    links: [["release", "https://docs.example/guide"]],
  },
  {
    name: "across links",
    selected: "guide and issue",
    expected: "[guide](https://docs.example/guide) and [issue](http://convene.example/issues/18)",
    links: [
      ["guide", "https://docs.example/guide"],
      ["issue", "http://convene.example/issues/18"],
    ],
  },
] as const;

it.each(
  linkCases.flatMap((testCase) => [false, true].map((richText) => ({ ...testCase, richText }))),
)(
  "retains $name through copy, paste, request and render (rich text=$richText)",
  async ({ name, selected, expected, links, richText }) => {
    setup();
    using sender = mockSender();
    let pending: Promise<void> | undefined;
    const source =
      "Read [release guide](https://docs.example/guide) and [issue 18](http://convene.example/issues/18) next.";
    await using screen = await render(
      <Conversation
        source={source}
        send={sender.send}
        richText={richText}
        onSent={(value) => {
          pending = value;
        }}
      />,
    );
    const reply = screen.getByTestId("reply").element();
    const p = reply.querySelector("p")!;
    const [first, second] = p.querySelectorAll("a");
    let range: Range;
    switch (name) {
      case "inside label":
        range = selectRange(textPoint(first!, 8), textPoint(first!, 13));
        break;
      case "inside Issue label":
        range = selectRange(textPoint(second!, 6), textPoint(second!, 8));
        break;
      case "whole label":
        range = selectRange(textPoint(first!, 0), textPoint(first!, 13));
        break;
      case "whole anchor":
        range = document.createRange();
        range.selectNode(first!);
        break;
      case "paragraph":
        range = document.createRange();
        range.selectNodeContents(p);
        break;
      case "from link":
        range = selectRange(textPoint(first!, 8), [p.lastChild!, p.lastChild!.textContent!.length]);
        break;
      case "into link":
        range = selectRange([p.firstChild!, 0], textPoint(first!, 7));
        break;
      case "across links":
        range = selectRange(textPoint(first!, 8), textPoint(second!, 5));
        break;
    }
    expect(range.toString()).toBe(selected);
    if (name === "inside label" || name === "inside Issue label" || name === "whole label") {
      expect(range.cloneContents().querySelector("a")).toBeNull();
    }
    const clipboard = await copyRange(p, range);
    expect.soft(clipboard.getData("text/plain")).toBe(expected);
    const html = new DOMParser().parseFromString(clipboard.getData("text/html"), "text/html");
    expect
      .soft([...html.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]))
      .toEqual(links);
    const editor = screen.container.querySelector<HTMLElement>(".tiptap")!;
    await act(() => {
      editor.focus();
      editor.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }),
      );
    });
    expect.soft(screen.getByTestId("draft").element().textContent).toBe(expected);
    await userEvent.click(screen.getByRole("button", { name: "Send copied draft" }));
    expect(pending).toBeDefined();
    await act(() => pending!);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]![0]).toBe(ORCHESTRATION_V2_WS_METHODS.dispatchCommand);
    const command = request.mock.calls[0]![1] as OrchestrationV2Command;
    expect(command).toMatchObject({ type: "message.dispatch", text: expected });
    const rendered = screen.getByTestId("sent").element();
    expect(
      [...rendered.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]),
    ).toEqual(links);
    expect(reply.textContent).toBe("Read release guide and issue 18 next.");
  },
);

it.each(["reports/status.md", "file:///tmp/public-example/reports/status.md"])(
  "preserves a file chip target %s through label copy, paste, request and render",
  async (href) => {
    setup();
    using sender = mockSender();
    let pending: Promise<void> | undefined;
    const expected = `[status.md](${href})`;
    const source = `Read ${expected}.`;
    await using screen = await render(
      <Conversation
        source={source}
        send={sender.send}
        richText
        onSent={(value) => {
          pending = value;
        }}
      />,
    );
    const reply = screen.getByTestId("reply").element();
    const chip = reply.querySelector("[data-markdown-copy]")!;
    const walker = document.createTreeWalker(chip, NodeFilter.SHOW_TEXT);
    let label: Node | null;
    do {
      label = walker.nextNode();
    } while (label && label.textContent !== "status.md");
    expect(label).not.toBeNull();
    const clipboard = await copyRange(chip, selectRange([label!, 0], [label!, 6]));
    expect(clipboard.getData("text/plain")).toBe(expected);
    const html = new DOMParser().parseFromString(clipboard.getData("text/html"), "text/html");
    expect(html.querySelector("[data-markdown-copy]")?.getAttribute("data-markdown-copy")).toBe(
      expected,
    );
    const editor = screen.container.querySelector<HTMLElement>(".tiptap")!;
    await act(() => {
      editor.focus();
      editor.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }),
      );
    });
    expect(screen.getByTestId("draft").element().textContent?.trimEnd()).toBe(expected);
    await userEvent.click(screen.getByRole("button", { name: "Send copied draft" }));
    await act(() => pending!);
    const command = request.mock.calls[0]![1] as OrchestrationV2Command;
    expect(command).toMatchObject({ type: "message.dispatch" });
    expect("text" in command && command.text.trimEnd()).toBe(expected);
    expect(
      screen
        .getByTestId("sent")
        .element()
        .querySelector("[data-markdown-copy]")
        ?.getAttribute("data-markdown-copy"),
    ).toBe(expected);
  },
);

function timelineMessage(
  text: string,
  records: ReadonlyArray<ThreadContextRecord>,
  routeThreadKey: string,
) {
  const createdAt = "2026-01-01T00:00:00.000Z";
  return (
    <div style={{ height: 500, width: 700, display: "flex", flexDirection: "column" }}>
      <MessagesTimeline
        isWorking={false}
        activeTurnInProgress={false}
        listRef={createRef<LegendListRef | null>()}
        latestRun={null}
        turnDiffSummaries={[]}
        runs={[]}
        routeThreadKey={routeThreadKey}
        onOpenTurnDiff={() => {}}
        onOpenThread={() => {}}
        onForkFromRun={async () => {}}
        supportsConversationRollback={false}
        onRevertToTurnCount={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        activeThreadEnvironmentId={EnvironmentId.make("clipboard-environment")}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
        anchorMessageId={null}
        onAnchorReady={() => {}}
        onAnchorSizeChanged={() => {}}
        contentInsetEndAdjustment={0}
        emptyPlaceholderInset={0}
        liveFollowEnabled
        onIsAtEndChange={() => {}}
        timelineEntries={
          [
            {
              id: "clipboard-entry",
              kind: "message",
              createdAt,
              message: {
                id: MessageId.make("context-source"),
                role: "user",
                text,
                runId: null,
                createdAt,
                updatedAt: createdAt,
                streaming: false,
                context: { version: 1, records },
              },
            },
          ] satisfies ComponentProps<typeof MessagesTimeline>["timelineEntries"]
        }
      />
    </div>
  );
}

it.each(
  ["inside label", "whole chip", "paragraph"].flatMap((selection) =>
    [false, true].map((htmlOnly) => ({ selection, htmlOnly })),
  ),
)(
  "imports only the selected timeline chip through $selection (HTML fallback=$htmlOnly)",
  async ({ selection, htmlOnly }) => {
    setup();
    const record = threadContextRecord(
      {
        environmentId: EnvironmentId.make("clipboard-environment"),
        threadId: ThreadId.make("source-thread"),
      },
      "Example thread",
    );
    const otherRecord = threadContextRecord(
      { environmentId: record.environmentId, threadId: ThreadId.make("unselected-thread") },
      "Other thread",
    );
    const reference = formatComposerContextReference(record);
    const source = `Before ${reference} after.\n\n${formatComposerContextReference(otherRecord)}`;
    const imported: ThreadContextRecord[] = [];
    const importFragment = vi.fn((fragment: ComposerContextClipboardFragment) => {
      for (const candidate of fragment.records) {
        const known = asKnownContextRecord(candidate);
        if (known?.kind === "thread" && known.environmentId === record.environmentId)
          imported.push(known);
      }
      return new Map(imported.map((candidate) => [candidate.contextId, candidate.contextId]));
    });
    using sender = mockSender(() =>
      buildMessageContext({
        terminalContexts: [],
        reviewComments: [],
        previewAnnotations: [],
        threadContexts: imported,
      }),
    );
    let pending: Promise<void> | undefined;
    const route = `clipboard:${selection}:${htmlOnly}`;
    await using screen = await render(
      <Conversation
        source={source}
        richText
        send={sender.send}
        onSent={(value) => {
          pending = value;
        }}
        renderReply={(text) => timelineMessage(text, [record, otherRecord], route)}
        renderSent={(text) => timelineMessage(text, imported, `${route}:sent`)}
        contextRecords={new Map([[record.contextId, { kind: "thread", record }]])}
        importContextFragment={importFragment}
      />,
    );
    const reply = screen.getByTestId("reply");
    await expect
      .element(reply.getByRole("link", { name: "Thread, Example thread", exact: true }))
      .toBeVisible();
    const chip = reply.getByRole("link", { name: "Thread, Example thread", exact: true }).element();
    let range: Range;
    if (selection === "inside label") range = selectRange(textPoint(chip, 8), textPoint(chip, 14));
    else {
      range = document.createRange();
      if (selection === "whole chip") range.selectNode(chip);
      else range.selectNodeContents(chip.closest("p")!);
    }
    const clipboard = await copyRange(chip, range);
    const expected = selection === "paragraph" ? `Before ${reference} after.` : reference;
    expect(clipboard.getData("text/plain")).toBe(expected);
    expect(
      decodeComposerContextFragment(clipboard.getData(COMPOSER_CONTEXT_CLIPBOARD_MIME))?.records,
    ).toEqual([record]);
    expect(decodeComposerContextClipboardHtml(clipboard.getData("text/html"))?.records).toEqual([
      record,
    ]);
    if (htmlOnly) clipboard.clearData(COMPOSER_CONTEXT_CLIPBOARD_MIME);
    const editor = screen.container.querySelector<HTMLElement>(".tiptap")!;
    await act(() => {
      editor.focus();
      editor.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }),
      );
    });
    expect(importFragment).toHaveBeenCalledOnce();
    expect(imported).toEqual([record]);
    expect(screen.getByTestId("draft").element().textContent?.trim()).toBe(expected);
    await userEvent.click(screen.getByRole("button", { name: "Send copied draft" }));
    await act(() => pending!);
    expect(request.mock.calls[0]![1]).toMatchObject({
      type: "message.dispatch",
      text: expect.stringContaining(reference),
      context: { version: 1, records: [record] },
    });
    await expect
      .element(
        screen
          .getByTestId("sent")
          .getByRole("link", { name: "Thread, Example thread", exact: true }),
      )
      .toBeVisible();
  },
);

it.each([
  {
    name: "ordinary text",
    source: "Plain text stays plain.",
    expected: "text stays",
    selector: "p",
    from: 6,
    to: 16,
  },
  {
    name: "code",
    source: '```text\nconst target = "[guide](https://docs.example/guide)";\n```',
    expected: 'const target = "[guide](https://docs.example/guide)";',
    selector: "pre code",
    from: 0,
    to: 51,
  },
])("keeps selected $name literal", async ({ source, expected, selector, from }) => {
  setup();
  using sender = mockSender();
  let pending: Promise<void> | undefined;
  await using screen = await render(
    <Conversation
      source={source}
      richText={false}
      send={sender.send}
      onSent={(value) => {
        pending = value;
      }}
    />,
  );
  const reply = screen.getByTestId("reply");
  const content = reply.element().querySelector(selector)!;
  const range = selectRange(textPoint(content, from), textPoint(content, from + expected.length));
  expect(range.toString()).toBe(expected);
  const clipboard = await copyRange(content, range);
  expect(clipboard.getData("text/plain")).toBe(expected);
  const editor = screen.container.querySelector<HTMLElement>(".tiptap")!;
  await act(() => {
    editor.focus();
    editor.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }),
    );
  });
  expect(screen.getByTestId("draft").element().textContent).toBe(expected);
  await userEvent.click(screen.getByRole("button", { name: "Send copied draft" }));
  await act(() => pending!);
  expect(request.mock.calls[0]![1]).toMatchObject({ type: "message.dispatch", text: expected });
});

it("keeps a formatted label's selection and target together", async () => {
  setup();
  using sender = mockSender();
  let pending: Promise<void> | undefined;
  await using screen = await render(
    <Conversation
      source="Read [release **guide**](https://docs.example/guide)."
      richText
      send={sender.send}
      onSent={(value) => {
        pending = value;
      }}
    />,
  );
  const strong = screen.getByTestId("reply").element().querySelector("strong")!;
  const clipboard = await copyRange(
    strong,
    selectRange(textPoint(strong, 0), textPoint(strong, 5)),
  );
  const expected = "[**guide**](https://docs.example/guide)";
  expect(clipboard.getData("text/plain")).toBe(expected);
  const html = new DOMParser().parseFromString(clipboard.getData("text/html"), "text/html");
  expect(html.querySelector("a strong")?.textContent).toBe("guide");
  const editor = screen.container.querySelector<HTMLElement>(".tiptap")!;
  await act(() => {
    editor.focus();
    editor.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }),
    );
  });
  await userEvent.click(screen.getByRole("button", { name: "Send copied draft" }));
  await act(() => pending!);
  expect(request.mock.calls[0]![1]).toMatchObject({ type: "message.dispatch", text: expected });
  const sentLink = screen.getByTestId("sent").element().querySelector("a")!;
  expect(sentLink.getAttribute("href")).toBe("https://docs.example/guide");
  expect(sentLink.querySelector("strong")?.textContent).toBe("guide");
});
