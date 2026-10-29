import { searchableMessageSegments } from "@t3tools/shared/threadFindText";
import { countThreadSearchOccurrences } from "@t3tools/shared/threadSearch";
import { page, userEvent } from "vite-plus/test/browser";
import { stubGlobal } from "../../test/render";
import { readLocalApi } from "../localApi";
import { toastManager } from "./ui/toast";
import { getSyntaxHighlighterPromise } from "../lib/syntaxHighlighting";
import { MarkdownFindContext } from "./chat/markdownFindContext";
import { useThreadFindHighlights } from "./chat/threadFindHighlights";
import { serializeTableElementToCsv, chatMarkdownClipboardPayload } from "../markdown-clipboard";
import { captureAssistantTextSelection } from "../lib/assistantTextSelection";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { type ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import "../index.css";

import { filesystemEnvironment } from "../state/filesystem";
import { useRightPanelStore } from "../rightPanelStore";
import { setMarkdownTaskChecked } from "./files/filePreviewMode";
import { HostImageUrlContext } from "./chat/hostImageUrl";

const { workspaceSearch, filesystemMetadata } = vi.hoisted(() => ({
  workspaceSearch: vi.fn(),
  filesystemMetadata: vi.fn(),
}));
vi.mock(import("../state/use-atom-query-runner"), async (original) => ({
  ...(await original()),
  useAtomQueryRunner: ((family: unknown) =>
    family === filesystemEnvironment.getMetadata ? filesystemMetadata : workspaceSearch) as never,
}));

// Atoms derived from the server config run in the real registry over a missing config.
vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const noConfig = Atom.make(null);
  return {
    ...actual,
    serverEnvironment: { ...actual.serverEnvironment, configValueAtom: (() => noConfig) as never },
  };
});
vi.mock(import("../state/session"), async (original) => {
  const { AuthStandardClientScopes } = await import("@t3tools/contracts");
  const granted = new Set<string>(AuthStandardClientScopes);
  const hasScope = (environmentId: unknown, scope: string) =>
    environmentId !== null && granted.has(scope);
  return {
    ...(await original()),
    useEnvironmentScope: hasScope as never,
    readEnvironmentScope: hasScope as never,
  };
});
vi.mock(import("../remoteOpen"), async (original) => ({
  ...(await original()),
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }) as never,
}));
const { renderDiagram } = vi.hoisted(() => ({
  renderDiagram: vi.fn<(source: string) => Promise<string> | undefined>(),
}));
// Control rendering latency without running Mermaid layout.
vi.mock(import("./chat/MermaidDiagram"), async (original) => {
  const { use } = await import("react");
  return {
    ...(await original()),
    MermaidDiagram: ({ source }: { source: string }) => {
      const pending = renderDiagram(source);
      return <svg role="img" aria-label={pending ? use(pending) : "Diagram"} />;
    },
  };
});

const settingsOverrides = vi.hoisted(() => ({ mathRenderingEnabled: false }));
vi.mock(import("../hooks/useSettings"), async (original) => {
  const actual = await original();
  type Settings = ReturnType<typeof actual.getClientSettings>;
  function useClientSettings<T = Settings>(select?: (settings: Settings) => T): T {
    const settings = { ...actual.getClientSettings(), ...settingsOverrides };
    return select ? select(settings) : (settings as T);
  }
  return { ...actual, useClientSettings };
});

import ChatMarkdown from "./ChatMarkdown";
import { AudioPreview } from "./files/AudioPreview";

it("keeps compact audio playback loaded across signed URL renewals", async () => {
  const original =
    "data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA";
  const renewed = `${original}#renewed`;
  const preview = (src: string, revision = "clip-v1") => (
    <AudioPreview compact name="clip.wav" src={src} revision={revision} />
  );
  await using screen = await render(preview(original));
  const audio = screen.container.querySelector("audio")!;
  await act(() => {
    audio.dispatchEvent(new Event("loadedmetadata"));
    audio.dispatchEvent(new Event("play"));
  });
  await screen.rerender(preview(renewed));
  expect(screen.container.querySelector("audio")).toBe(audio);
  expect(audio.getAttribute("src")).toBe(original);
  await expect.element(screen.getByRole("button", { name: "Pause clip.wav" })).toBeEnabled();
  await screen.rerender(preview(renewed, "clip-v2"));
  expect(screen.container.querySelector("audio")).not.toBe(audio);
  expect(screen.container.querySelector("audio")?.getAttribute("src")).toBe(renewed);
});

function setup() {
  settingsOverrides.mathRenderingEnabled = false;
  renderDiagram.mockReset();
  workspaceSearch.mockReset().mockResolvedValue(AsyncResult.success({ entries: [] }));
  filesystemMetadata.mockReset().mockResolvedValue(AsyncResult.success({ entries: [null] }));
}

function renderText(text: string, props: Partial<Parameters<typeof ChatMarkdown>[0]> = {}) {
  return render(<ChatMarkdown cwd="/tmp/project" text={text} {...props} />);
}

function buttonsLabelled(container: HTMLElement, label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => button.getAttribute("aria-label") === label,
  );
}

it("shows unavailable audio when a workspace embed has no thread", async () => {
  setup();
  await using screen = await renderText("![recording](clip.wav)");
  expect(screen.container.textContent).toContain("Audio unavailable");
  expect(screen.container.textContent).not.toContain("Loading audio");
  expect(screen.container.querySelector("audio")).toBeNull();
});

it("loads a host image through the page's own route when there is no environment", async () => {
  setup();
  const pixel =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const hostImageUrl = vi.fn((_path: string) => pixel);
  await using screen = await render(
    <HostImageUrlContext value={hostImageUrl}>
      <ChatMarkdown cwd={undefined} text="![Shot](</work/my shot.png>)" />
    </HostImageUrlContext>,
  );
  await expect.element(screen.getByAltText("Shot")).toHaveAttribute("src", pixel);
  expect(new Set(hostImageUrl.mock.calls.map(([path]) => path))).toEqual(
    new Set(["/work/my shot.png"]),
  );
});

describe("ChatMarkdown favicon privacy", () => {
  it("suppresses private link images while preserving public links across updates", async () => {
    setup();
    const markdown = (url: string) => <ChatMarkdown cwd="/tmp/project" text={`[Link](${url})`} />;
    await using screen = await render(markdown("https://example.com"));
    const { container, rerender } = screen;
    expect([...container.querySelectorAll("img")].map((image) => image.src)).toEqual([
      "https://www.google.com/s2/favicons?domain=example.com&sz=32",
    ]);
    for (const url of ["http://192.168.1.10:8080", "http://localhost:3000", "http://home.arpa"]) {
      await rerender(markdown(url));
      expect(container.querySelectorAll("img")).toHaveLength(0);
    }
    await rerender(markdown("https://example.com"));
    expect(container.querySelectorAll("img")).toHaveLength(1);
    await rerender(markdown("https://github.com/pingdotgg/t3code/pull/1"));
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelector("a svg")).not.toBeNull();
  });
});

describe("ChatMarkdown streaming", () => {
  it("runs only a complete single-line shell block after a click", async () => {
    setup();
    const onRunShellCommand = vi.fn();
    const message = (text: string, isStreaming = false) => (
      <ChatMarkdown
        cwd="/tmp/project"
        text={text}
        isStreaming={isStreaming}
        onRunShellCommand={onRunShellCommand}
      />
    );
    await using screen = await render(message("```bash\necho hello\n```", true));
    const { container, rerender } = screen;
    const runButtons = () => buttonsLabelled(container, "Run in terminal");
    expect(runButtons()).toHaveLength(0);

    await rerender(message("```bash\necho hello\n```"));
    await act(async () => runButtons()[0]!.click());
    expect(onRunShellCommand).toHaveBeenCalledExactlyOnceWith("echo hello");

    for (const text of [
      "~~~bash\necho tilde\n~~~",
      "> ```bash\n> echo quote\n> ```",
      "````bash\necho four\n````",
      "- Command\n\n  ```bash\n  echo list\n  ```",
      "```bash\r\necho crlf\r\n```\r",
    ]) {
      await rerender(message(text));
      expect(runButtons()).toHaveLength(1);
    }

    for (const text of [
      "```bash\necho one\necho two\n```",
      "```typescript\necho hello\n```",
      "```bash\n\n```",
      "```bash\necho hello\n\n```",
      "```bash\necho hello\\\n```",
      "```bash\necho safe \u202e#\n```",
      "```bash\necho incomplete",
      "~~~bash\necho incomplete",
      "````bash\necho incomplete\n```",
      '<pre><code class="language-bash">echo html</code></pre>',
    ]) {
      await rerender(message(text));
      expect(runButtons()).toHaveLength(0);
    }
  });

  it("edits the current task text and marker after reusing a renderer", async () => {
    setup();
    let editedText: string | undefined;
    let rerender: (next: ReactElement) => Promise<void> = async () => {};
    const message = (text: string): ReactElement => (
      <ChatMarkdown
        cwd="/tmp/project"
        text={text}
        onTaskListChange={({ markerOffset, checked }) => {
          editedText = setMarkdownTaskChecked(text, markerOffset, checked);
          void rerender(message(editedText));
        }}
      />
    );
    await using rendered = await render(message("- [ ] First\n- [ ] Second"));
    rerender = rendered.rerender;
    const { container } = rendered;
    const checkboxes = () => container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    const original = checkboxes()[1]!;
    await rerender(message("- [ ] A longer first task\n- [ ] Second"));
    expect(checkboxes()[1]).toBe(original);

    await act(async () => original.click());
    expect(editedText).toBe("- [ ] A longer first task\n- [x] Second");
    await vi.waitFor(() => expect(checkboxes()[1]!.checked).toBe(true));
  });
});

describe("ChatMarkdown workspace file opens", () => {
  const threadRef = {
    environmentId: EnvironmentId.make("workspace"),
    threadId: ThreadId.make("thread"),
  };

  it("keeps a newer absolute file open when an earlier repo-relative lookup finishes", async () => {
    setup();
    const result = AsyncResult.success({
      entries: [{ path: "notes/a.md", kind: "file" }],
      truncated: false,
    });
    let resolvePending!: (value: typeof result) => void;
    const pending = new Promise<typeof result>((resolve) => {
      resolvePending = resolve;
    });
    workspaceSearch.mockReturnValueOnce(pending);
    using openFile = vi
      .spyOn(useRightPanelStore.getState(), "openFile")
      .mockImplementation(() => {});
    await using screen = await renderText(
      "[Notes](physics/notes/a.md) and [Other](/elsewhere/b.md:9)",
      {
        cwd: "/school/physics",
        threadRef,
      },
    );
    const { container } = screen;
    const [notes, other] = container.querySelectorAll("a");
    await act(async () => notes!.click());
    expect(workspaceSearch).toHaveBeenCalledOnce();
    expect(openFile).not.toHaveBeenCalled();

    await act(async () => other!.click());
    await act(async () => resolvePending(result));

    expect(openFile).toHaveBeenCalledExactlyOnceWith(threadRef, "/elsewhere/b.md", 9);
    expect(workspaceSearch).toHaveBeenCalledOnce();
  });
});

describe("ChatMarkdown skill chips", () => {
  it("shows the skill's details and opens its instructions", async () => {
    setup();
    const threadRef = {
      environmentId: EnvironmentId.make("workspace"),
      threadId: ThreadId.make("thread"),
    };
    await using screen = await renderText("Run $review now", {
      threadRef,
      skills: [
        {
          name: "review",
          displayName: "Review",
          description: "Reviews the current branch.",
          path: "/skills/review/SKILL.md",
          enabled: true,
        },
      ],
    });
    using openFile = vi
      .spyOn(useRightPanelStore.getState(), "openFile")
      .mockImplementation(() => {});

    await userEvent.click(screen.getByRole("button", { name: "Skill Review. Show details" }));
    await expect.element(page.getByText("Reviews the current branch.")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "View instructions" }));

    expect(openFile).toHaveBeenCalledExactlyOnceWith(threadRef, "/skills/review/SKILL.md");
  });
});

describe("ChatMarkdown headings", () => {
  it("never gives two headings the same id, even when a suffix matches another heading", async () => {
    setup();
    await using screen = await renderText(
      '## Setup\n\n## Setup\n\n## Setup-1\n\n<h2 id="install-1">Pinned</h2>\n\n## Install\n\n## Install',
      { parseRawHtml: true },
    );
    const { container } = screen;
    expect([...container.querySelectorAll("h2")].map((heading) => heading.id)).toEqual([
      "user-content-setup",
      "user-content-setup-1",
      "user-content-setup-1-1",
      "user-content-install-1",
      "user-content-install",
      "user-content-install-2",
    ]);
  });
});

describe("ChatMarkdown inline code selection", () => {
  it("selects the whole inline code span on double-click, but only a word in fenced code", async () => {
    setup();
    await using screen = await renderText(
      "Run `migration-gate --dry-run` first.\n\n```txt\nfenced-block word\n```",
    );
    await userEvent.dblClick(screen.getByText("migration-gate --dry-run"));
    expect(window.getSelection()?.toString()).toBe("migration-gate --dry-run");

    window.getSelection()?.removeAllRanges();
    const fenced = screen.container.querySelector("pre code")!;
    await userEvent.dblClick(fenced, { position: { x: 4, y: 4 } });
    expect(window.getSelection()?.toString()).toBe("fenced");
  });
});

describe("ChatMarkdown Windows file links", () => {
  const environmentId = EnvironmentId.make("env-windows");
  const renderWindows = (text: string, parseRawHtml: boolean) =>
    renderText(text, {
      cwd: "C:/Users/shawn/project",
      environmentId,
      lineBreaks: !parseRawHtml,
      parseRawHtml,
    });
  const fileHrefs = (container: HTMLElement) =>
    [...container.querySelectorAll(".chat-markdown-file-link")].map((chip) =>
      chip.getAttribute("href"),
    );

  it("still rejects unsafe schemes", async () => {
    setup();
    for (const parseRawHtml of [true, false]) {
      await using screen = await renderWindows(
        "[unsafe](javascript:alert(1)) and [unknown](d:alert(1))",
        parseRawHtml,
      );
      const { container } = screen;
      expect(container.innerHTML).not.toContain("javascript:");
      expect(container.innerHTML).not.toContain("d:alert");
      expect(fileHrefs(container)).toEqual([]);
    }
  });
});

describe("ChatMarkdown in-page links", () => {
  it.each([true, false])(
    "scrolls a table-of-contents link to its heading without touching the URL (parseRawHtml=%s)",
    async (parseRawHtml) => {
      setup();
      using scrollIntoView = vi
        .spyOn(HTMLElement.prototype, "scrollIntoView")
        .mockImplementation(() => {});
      const href = window.location.href;
      await using screen = await renderText(
        "- [Operating model](#1-operating-model)\n- [Missing](#nowhere)\n\n## 1. Operating model\n\n## 1. Operating model",
        { parseRawHtml },
      );
      const { container } = screen;
      const headings = [...container.querySelectorAll("h2")];
      expect(headings.map((heading) => heading.id)).toEqual([
        "user-content-1-operating-model",
        "user-content-1-operating-model-1",
      ]);
      const [tocLink, missingLink] = [...container.querySelectorAll("a")];
      await act(async () => tocLink!.click());
      expect(scrollIntoView.mock.contexts).toEqual([headings[0]]);
      await act(async () => missingLink!.click());
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(window.location.href).toBe(href);
    },
  );
});

describe("ChatMarkdown thread find", () => {
  function FindProbe(props: {
    container: HTMLElement;
    query: string;
    activeOccurrence?: number;
    children: ReactElement;
  }) {
    useThreadFindHighlights({
      container: props.container,
      query: props.query,
      activeRowId: "row",
      activeOccurrence: props.activeOccurrence ?? 0,
      onActiveRange: () => {},
    });
    return (
      <div data-timeline-row-id="row">
        <div data-thread-find-text>
          <MarkdownFindContext value={props.query !== ""}>{props.children}</MarkdownFindContext>
        </div>
      </div>
    );
  }
  // Highlights live in a document-wide registry the rendered tree does not own.
  const clearHighlights = () => ({ [Symbol.dispose]: () => CSS.highlights.clear() });
  const activeHighlights = () =>
    [...(CSS.highlights.get("t3-thread-find-active") ?? [])].map((range) =>
      (range as Range).toString(),
    );

  it("opens a disclosure only when find selects a match inside it", async () => {
    setup();
    using _highlights = clearHighlights();
    const container = document.createElement("div");
    const markdown = (
      <ChatMarkdown
        cwd={undefined}
        text={[
          "Visible needle.",
          "<details><summary>Unrelated</summary><p>nothing here</p></details>",
          "<details><summary>Outer</summary><details><summary>Inner</summary><p>needle</p></details></details>",
        ].join("\n\n")}
      />
    );
    const probe = (query: string, activeOccurrence: number) => (
      <FindProbe container={container} query={query} activeOccurrence={activeOccurrence}>
        {markdown}
      </FindProbe>
    );
    await using screen = await render(probe("", 0), { container });
    const show = (query: string, activeOccurrence: number) =>
      screen.rerender(probe(query, activeOccurrence));
    const openStates = () =>
      [...container.querySelectorAll<HTMLElement>("[data-markdown-details-open]")].map(
        (node) => node.dataset.markdownDetailsOpen,
      );

    expect(container.textContent).not.toContain("nothing here");
    await show("needle", 0);
    await vi.waitFor(() => expect(activeHighlights()).toEqual(["needle"]));
    expect(openStates()).toEqual(["false", "false", "false"]);
    expect(container.textContent).toContain("nothing here");
    expect(activeHighlights()).toEqual(["needle"]);
    expect(CSS.highlights.get("t3-thread-find")?.size ?? 0).toBe(0);

    await show("needle", 1);
    await vi.waitFor(() => expect(openStates()).toEqual(["false", "true", "true"]));
    expect(openStates()).toEqual(["false", "true", "true"]);
    await vi.waitFor(() => expect(CSS.highlights.get("t3-thread-find-active")?.size).toBe(1));
  });

  it("keeps Mermaid diagrams rendered until find selects a match in their source", async () => {
    setup();
    using _highlights = clearHighlights();
    const container = document.createElement("div");
    const diagram = "```mermaid\ngraph TD; Alpha-->Beta\n```";
    const probe = (query: string) => (
      <FindProbe container={container} query={query}>
        <ChatMarkdown cwd={undefined} text={`Needle first.\n\n${diagram}\n\n${diagram}`} />
      </FindProbe>
    );
    const diagrams = () => container.querySelectorAll('svg[aria-label="Diagram"]').length;

    await using screen = await render(probe("Needle"), { container });
    await vi.waitFor(() => expect(diagrams()).toBe(2));
    await screen.rerender(probe("Alpha"));
    await vi.waitFor(() => expect(diagrams()).toBe(1));
    await vi.waitFor(() => expect(activeHighlights()).toEqual(["Alpha"]));
  });

  it.each([
    {
      text: "```mermaid\ngraph TD; SearchSourceAlpha-->B\n```",
      query: "SearchSourceAlpha",
      count: 1,
    },
    {
      text: "★ Insight ─────\nfirst line\nsecond line",
      query: "first line second",
      count: 0,
      lineBreaks: true,
    },
    { text: '```ts title="src/needle.ts"\nconst a = 1;\n```', query: "needle", count: 0 },
    { text: "```weirdlang\nconst a = 1;\n```", query: "weirdlang", count: 0 },
    { text: "Use $test-t3-app now", query: "T3 App Testing", count: 1 },
    { text: "`/tmp/file.ts:42`", query: "file.ts · L42", count: 1, user: true, lineBreaks: true },
    { text: "> [!NOTE]\n> Searchable alert", query: "Searchable alert", count: 1 },
    {
      text: "<details><summary>Folded</summary><p>Hidden needle</p></details>",
      query: "Hidden needle",
      count: 1,
    },
    { text: ARTIFACT_TEMPLATE_DIRECTIVE, query: "Hello World", count: 1, withTemplate: true },
    {
      text: ARTIFACT_TEMPLATE_DIRECTIVE,
      query: "Document template",
      count: 1,
      withTemplate: true,
    },
    { text: ARTIFACT_TEMPLATE_DIRECTIVE, query: "World Document", count: 0, withTemplate: true },
    { text: ARTIFACT_TEMPLATE_DIRECTIVE, query: "Use template", count: 0, withTemplate: true },
  ])(
    "highlights the indexed occurrences of $query in $text",
    async ({ text, query, count, lineBreaks, user, withTemplate }) => {
      setup();
      const skills = [{ name: "test-t3-app", displayName: "T3 App Testing" }];
      using _highlights = clearHighlights();
      const container = document.createElement("div");
      await using _screen = await render(
        <FindProbe container={container} query={query}>
          <ChatMarkdown
            text={text}
            cwd={undefined}
            skills={skills.map((skill) => ({
              ...skill,
              path: `/skills/${skill.name}`,
              enabled: true,
            }))}
            lineBreaks={lineBreaks ?? false}
            parseRawHtml={!user}
            onUseArtifactTemplate={withTemplate ? () => undefined : undefined}
          />
        </FindProbe>,
        { container },
      );
      // Lazy blocks such as Mermaid can swap their source text after the first frame,
      // emptying a range for a moment, so wait for the highlights to settle.
      await vi.waitFor(() => {
        const ranges = [...CSS.highlights.values()].flatMap((value) => [...value]);
        expect(ranges.map((range) => (range as Range).toString())).toEqual(
          Array.from({ length: count }, () => query),
        );
      });
      const segments =
        searchableMessageSegments(
          { role: user ? "user" : "assistant", text, streaming: false },
          undefined,
          skills,
        ) ?? [];
      expect(
        segments.reduce((sum, segment) => sum + countThreadSearchOccurrences(segment, query), 0),
      ).toBe(count);
    },
  );
});

it.each([
  {
    name: "Windows drive paths on a Mac client",
    platform: "MacIntel",
    cwd: "C:/repo",
    href: "C:/repo/reports/Device Users.csv:12:3",
    full: String.raw`C:\repo\reports\Device Users.csv:12:3`,
    relative: String.raw`reports\Device Users.csv:12:3`,
  },
  {
    name: "UNC paths on a Mac client",
    platform: "MacIntel",
    cwd: String.raw`\\server\share\repo`,
    href: "file://server/share/repo/reports/report.csv",
    full: String.raw`\\server\share\repo\reports\report.csv`,
    relative: String.raw`reports\report.csv`,
  },
  {
    name: "POSIX paths on a Windows client",
    platform: "Win32",
    cwd: "/home/repo",
    href: "/home/repo/reports/report.csv",
    full: "/home/repo/reports/report.csv",
    relative: "reports/report.csv",
  },
])("copies $name and shows the copied text", async ({ platform, cwd, href, full, relative }) => {
  setup();
  using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  using _clipboardItem = stubGlobal("ClipboardItem", undefined);
  using writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  using toast = vi.spyOn(toastManager, "add");
  const api = readLocalApi();
  if (!api) throw new Error("Local API unavailable");
  using choose = vi.spyOn(api.contextMenu, "show");
  await using screen = await renderText(`[File](<${href}>)`, {
    cwd,
    environmentId: EnvironmentId.make("env-file-copy"),
  });
  const { container } = screen;
  const link = container.querySelector(".chat-markdown-file-link");
  if (!link) throw new Error("File link unavailable");
  for (const [action, expected] of [
    ["copy-full", full],
    ["copy-relative", relative],
  ] as const) {
    choose.mockResolvedValue(action);
    await act(async () => {
      link.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    expect(writeText).toHaveBeenLastCalledWith(expected);
    expect(toast).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "success", description: expected }),
    );
  }
});

describe("ChatMarkdown math", () => {
  const renderMath = async (
    text: string,
    options: Partial<Parameters<typeof ChatMarkdown>[0]> = {},
  ) => {
    settingsOverrides.mathRenderingEnabled = true;
    await using stack = new AsyncDisposableStack();
    const screen = stack.use(
      await render(<ChatMarkdown cwd="/tmp/project" text={text} {...options} />),
    );
    screen.container.setAttribute("data-assistant-citation-source", "assistant");
    await act(async () => {
      await import("./chat/MathTypeset");
    });
    stack.move();
    return screen;
  };

  it.each(["$x$", "$$x$$", "```math\nx\n```", "$\\notACommand{x}$"])(
    "keeps keyboard focus on the parent control in compact previews of %s",
    async (formula) => {
      setup();
      settingsOverrides.mathRenderingEnabled = true;
      await using screen = await render(
        <>
          <button type="button">
            Preview <ChatMarkdown inline text={formula} cwd={undefined} />
          </button>
          <button type="button">After preview</button>
        </>,
      );
      const { container } = screen;
      await act(async () => {
        await import("./chat/MathTypeset");
      });
      const [preview, after] = container.querySelectorAll("button");
      preview!.focus();
      await userEvent.tab();
      expect(document.activeElement).toBe(after);
      if (formula.includes("notACommand")) {
        expect(page.getByRole("button", { name: /notACommand/ }).element()).toBe(preview);
      }
    },
  );

  it("keeps message formulas reachable by keyboard", async () => {
    setup();
    settingsOverrides.mathRenderingEnabled = true;
    await using screen = await render(
      <>
        <button type="button">Before equation</button>
        <ChatMarkdown text="$x$" cwd={undefined} />
      </>,
    );
    const { container } = screen;
    container.querySelector("button")!.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(
      container.querySelector('[aria-label="Scroll inline equation"]'),
    );
  });

  it("renders table formulas and exports their TeX instead of duplicate glyph text", async () => {
    setup();
    await using rendered = await renderMath(
      "| Name | Formula |\n| --- | --- |\n| Norm | $|x|$ and \\(\\|y\\|\\) |\n| Price | $5 and $10 |",
    );

    const table = rendered.container.querySelector("table")!;
    expect([...table.rows].map((row) => row.cells.length)).toEqual([2, 2, 2]);
    expect(table.querySelectorAll(".katex")).toHaveLength(2);
    const norm = table.querySelectorAll(".katex")[1]!;
    expect([...norm.querySelectorAll(".katex-mathml mi")].map((node) => node.textContent)).toEqual([
      "∥",
      "y",
      "∥",
    ]);
    expect(serializeTableElementToCsv(table)).toBe(
      "Name,Formula\nNorm,\\(|x|\\) and \\(\\|y\\|\\)\nPrice,$5 and $10",
    );
    const glyph = table.querySelector(".katex-mathml mi")!.firstChild!;
    const range = document.createRange();
    range.setStart(glyph, 0);
    range.setEnd(glyph, 1);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const payload = chatMarkdownClipboardPayload(selection)!;
    expect(payload.text).toBe("\\(|x|\\)");
    expect(payload.html).toContain("\\(|x|\\)");
    expect(payload.html).not.toContain("katex");
    expect(captureAssistantTextSelection(rendered.container, selection)?.selector.text).toBe(
      "\\(|x|\\)",
    );
  });

  it("renders explicit math fences and keeps unfinished streamed fences readable", async () => {
    setup();
    await using rendered = await renderMath("```math\nx_i^2\n```\n\n`$literal$`\n\n$unfinished");

    expect(rendered.container.querySelectorAll(".katex")).toHaveLength(1);
    expect(rendered.container.textContent).toContain("$literal$");
    expect(rendered.container.textContent).toContain("$unfinished");

    await using streamed = await renderMath("```math\nx_i^2", { isStreaming: true });

    expect(streamed.container.querySelector(".katex")).toBeNull();
    expect(streamed.container.textContent).toContain("x_i^2");
  });

  it.each(["$$\nx^2\n", "\\[\nx^2\n"])(
    "keeps unfinished display %s and following prose readable while streaming",
    async (source) => {
      setup();
      for (const text of [source, `${source}\nFollowing prose.`]) {
        await using math = await renderMath(text, { isStreaming: true });
        expect(math.container.querySelector(".katex")).toBeNull();
        expect(math.container.querySelector("[data-markdown-math]")).toBeNull();
        expect(math.container.textContent).toContain("x^2");
        if (text.includes("Following prose."))
          expect(math.container.textContent).toContain("Following prose.");
      }
    },
  );

  it.each(["$$x^2$$", "$$\nx^2\n$$", "\\[\nx^2\n\\]", "```math\nx^2\n```"])(
    "renders completed %s while the response is streaming",
    async (source) => {
      setup();
      await using math = await renderMath(source, { isStreaming: true });
      expect(math.container.querySelectorAll(".katex")).toHaveLength(1);
      expect(math.container.querySelector('[data-markdown-math="display"]')).not.toBeNull();
    },
  );

  it("shows unsupported TeX as source and keeps active TeX commands inert", async () => {
    setup();
    await using rendered = await renderMath(
      "\\(\\notACommand{x}\\) and \\(\\href{https://example.com}{x}\\)",
    );

    expect(rendered.container.textContent).toContain("\\(\\notACommand{x}\\)");
    expect(rendered.container.querySelector('a[href="https://example.com"]')).toBeNull();
  });

  it("typesets only when enabled, keeping prices and task offsets intact", async () => {
    setup();
    const text = "Area $\\pi r^2$ costs $5 and $10.\n\n\\[\nE = mc^2\n\\]\n\n- [ ] check \\(x\\)";
    await using off = await renderText(text);
    expect(off.container.querySelector("[data-markdown-math]")).toBeNull();
    await using html = await renderText('<code class="language-math math-inline">x</code>');
    expect(html.container.querySelector("[data-markdown-math]")).toBeNull();
    for (const parseRawHtml of [true, false]) {
      let editedText = text;
      await using math = await renderMath(text, {
        parseRawHtml,
        onTaskListChange: ({ markerOffset, checked }) => {
          editedText = setMarkdownTaskChecked(text, markerOffset, checked);
        },
      });
      expect(
        [...math.container.querySelectorAll("[data-markdown-math]")].map((node) =>
          node.getAttribute("data-markdown-copy"),
        ),
      ).toEqual(["\\(\\pi r^2\\)", "\\[\nE = mc^2\n\\]\n\n", "\\(x\\)"]);
      await act(() =>
        math.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
      );
      expect(editedText).toBe(text.replace("- [ ]", "- [x]"));
    }
    await using math = await renderMath("-       intro\n\n        $$\n        x^2\n        $$");
    expect(
      [...math.container.querySelectorAll("[data-markdown-math]")].map((node) =>
        node.getAttribute("data-markdown-copy"),
      ),
    ).toEqual(["\\[\nx^2\n\\]\n\n"]);
  });
});

import { i18n } from "../i18n";
const ARTIFACT_TEMPLATE_DIRECTIVE =
  '::artifact-template{skill_name="artifact-template-hello-world" skill_directory="/Users/test/.codex/skills/artifact-template-hello-world" display_name="Hello World" artifact_kind="document"}';

it("relabels Markdown controls without resetting wrapping or duplicating a pending copy", async () => {
  setup();
  await getSyntaxHighlighterPromise("github-dark");

  const originalLanguage = i18n.language;
  const run = vi.fn();
  let finishCopy!: () => void;
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishCopy = resolve;
      }),
  );
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const container = document.createElement("div");
  container.style.width = "400px";
  document.body.append(container);
  await using root = await render(null, { container, router: false });
  const button = (label: string) => {
    const element = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!element) throw new Error(`Missing Markdown control: ${label}`);
    return element;
  };
  const text =
    '```bash\necho "Keep 原文"\n```\n\n| Field | Value |\n| --- | --- |\n| raw_id | New thread long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content long table content |\n\n```mermaid\ngraph TD; Alpha-->Beta\n```';
  try {
    await act(async () => {
      await i18n.changeLanguage("en");
      await root.rerender(<ChatMarkdown cwd={undefined} text={text} onRunShellCommand={run} />);
    });
    const code = container.querySelector('[data-language="bash"]')!;
    const table = container.querySelector("table")!;
    const initialWrap = code.getAttribute("data-wrap");
    const initialExpanded = table.closest("[data-expanded]")!.getAttribute("data-expanded");
    await act(async () => {
      button(initialWrap === "true" ? "Disable line wrap" : "Wrap lines").click();
      button(initialExpanded === "true" ? "Collapse table cells" : "Expand table cells").click();
      button("Show code").click();
      button("Copy code").click();
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith('echo "Keep 原文"\n');
    await act(async () => {
      await i18n.changeLanguage("zh");
    });
    expect(container.querySelector('[data-language="bash"]')).toBe(code);
    expect(container.querySelector("table")).toBe(table);
    expect(code.getAttribute("data-wrap")).not.toBe(initialWrap);
    expect(table.closest("[data-expanded]")!.getAttribute("data-expanded")).not.toBe(
      initialExpanded,
    );
    expect(button("显示图表")).toBeTruthy();
    expect(button("在终端中运行")).toBeTruthy();
    expect(container.querySelector('[role="toolbar"]')?.getAttribute("aria-label")).toBe(
      "代码块操作",
    );
    expect(container.textContent).toContain("raw_id");
    expect(container.textContent).toContain("New thread");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    await act(async () => {
      finishCopy();
    });
    expect(button("已复制")).toBeTruthy();
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    expect(button("Copied")).toBeTruthy();
    expect(button("Show diagram")).toBeTruthy();
    await act(async () => {
      button("Run in terminal").click();
    });
    expect(run).toHaveBeenCalledExactlyOnceWith('echo "Keep 原文"');
    expect(writeText).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => {
      await root.unmount();
      await i18n.changeLanguage(originalLanguage);
    });
    container.remove();
    if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
    vi.unstubAllGlobals();
  }
});
