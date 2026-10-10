// @vitest-environment jsdom
import { EnvironmentId, ProjectId, type PullRequestDetailView } from "@t3tools/contracts";
import { act, useRef, useState } from "react";
import * as Cause from "effect/Cause";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { changeLanguage } from "~/i18n";
import { PullRequestCommentForm } from "./PullRequestCommentForm";
import { PullRequestComposer } from "./PullRequestComposer";
import { PullRequestReviewForm } from "./PullRequestReviewForm";
import { PullRequestMarkdownEditor } from "./PullRequestMarkdownEditor";
import { PullRequestLabelPicker } from "./PullRequestLabelPicker";
import { PullRequestReviewerPicker } from "./PullRequestReviewerPicker";
import { PullRequestSummaryTab } from "./PullRequestSummaryTab";
import { PullRequestTimelineTab } from "./PullRequestTimelineTab";
import { PullRequestRowLines } from "./PullRequestListRow";
import { DiffCommentAnnotation } from "../diffs/DiffCommentAnnotation";
import { pullRequestReviewKey, usePullRequestReviewStore } from "./pullRequestReviewStore";

const fixture = vi.hoisted(() => ({
  post: vi.fn(),
  review: vi.fn(),
  labels: vi.fn(),
  reviewers: vi.fn(),
  toast: vi.fn(),
  onClose: vi.fn(),
  onCommented: vi.fn(),
  onSubmitted: vi.fn(),
  onCommentAction: vi.fn(),
  labelCandidates: {
    candidates: [
      { name: "bug 原文", color: "ff0000", description: "Raw label description", isApplied: false },
    ],
    truncated: true,
  },
  reviewerCandidates: {
    candidates: [
      {
        id: "team-raw",
        kind: "team",
        login: "acme/原文",
        name: "Raw team name",
        avatarUrl: null,
        isRequested: true,
      },
    ],
    truncated: false,
  },
}));
vi.mock("~/state/pullRequests", () => ({
  pullRequestEnvironment: {
    comment: "post",
    submitReview: "review",
    setLabels: "labels",
    requestReviewers: "reviewers",
    labelCandidates: () => "labelCandidates",
    reviewerCandidates: () => "reviewerCandidates",
  },
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: keyof typeof fixture) => fixture[command],
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (query: "labelCandidates" | "reviewerCandidates" | null) => ({
    data: query ? fixture[query] : null,
    isPending: false,
    error: null,
  }),
}));
vi.mock("~/state/session", () => ({
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: fixture.toast } }));
vi.mock("~/browser/useOpenLink", () => ({ useOpenLink: () => vi.fn() }));
// The editor still owns the real input, mode and save controls; preview parsing is not under test.
vi.mock("./PullRequestMarkdown", () => ({
  PullRequestMarkdown: ({ text }: { text: string }) => <article>{text}</article>,
}));

const environmentId = EnvironmentId.make("environment-raw");
const reference = {
  projectId: ProjectId.make("project-raw"),
  host: "github.com",
  repository: "acme/raw",
  number: 101,
};
const detail: PullRequestDetailView = {
  ...reference,
  provider: "github",
  projectTitle: "Raw project",
  workspaceRoot: "/repo/原文",
  title: "Raw title 原文",
  body: "Raw body 原文",
  url: "https://github.com/acme/raw/pull/101",
  author: null,
  viewer: "viewer-raw",
  state: "open",
  isDraft: false,
  mergeability: "mergeable",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  headBranch: "feature/原文",
  baseBranch: "main",
  createdAt: "2026-10-09T00:00:00Z",
  updatedAt: "2026-10-09T00:00:00Z",
  mergedAt: null,
  closedAt: null,
  reviewers: [],
  labels: [],
  checks: [],
  comments: [],
  commentCount: 0,
  commentsTruncated: false,
  reviewThreads: [],
  commits: [],
  mergeCapabilities: { merge: true, squash: true, rebase: true },
  capabilities: {
    diff: true,
    comment: true,
    search: true,
    actions: ["close", "reopen"],
    mergeMethods: ["merge"],
    review: {
      inlineComment: true,
      reply: true,
      resolve: true,
      verdicts: ["comment", "approve", "request-changes"],
    },
    reviewers: { request: true, listCandidates: true },
    edit: { changeRequest: true, comment: true },
  },
  viewerPermissions: {
    actions: ["close", "reopen"],
    comment: true,
    resolve: true,
    verdicts: ["comment", "approve", "request-changes"],
    requestReviewers: true,
  },
};
let root: Root;
let container: HTMLDivElement;
function button(name: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === name || node.getAttribute("aria-label") === name,
  );
  expect(found, name).toBeDefined();
  return found!;
}
async function click(name: string) {
  await act(async () => button(name).click());
}
async function input(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function deferred() {
  let finish!: (result: { _tag: string; cause?: Cause.Cause<unknown> }) => void;
  const promise = new Promise<{ _tag: string; cause?: Cause.Cause<unknown> }>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}
function Comment({ state = "open" }: { state?: "open" | "closed" }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <PullRequestCommentForm
      environmentId={environmentId}
      reference={reference}
      detail={{ ...detail, state }}
      actionPending={false}
      textareaRef={ref}
      onCommentAction={fixture.onCommentAction}
      onCommented={fixture.onCommented}
      onClose={fixture.onClose}
    />
  );
}
function Review({ approve = false }: { approve?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [pending, setPending] = useState(false);
  return (
    <PullRequestReviewForm
      environmentId={environmentId}
      reference={reference}
      verdicts={approve ? ["approve"] : ["request-changes"]}
      requestChangesSummaryRequired
      textareaRef={ref}
      pending={pending}
      onPendingChange={setPending}
      onSubmitted={fixture.onSubmitted}
    />
  );
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  vi.clearAllMocks();
  usePullRequestReviewStore.setState({ drafts: {}, summaries: {} });
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  await changeLanguage("en");
  vi.useRealTimers();
});

it.each(["summary", "timeline"] as const)(
  "updates %s comment dates on language changes without rewriting the comment",
  async (tab) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
    const value: PullRequestDetailView = {
      ...detail,
      commentCount: 1,
      comments: [
        {
          id: "raw-comment",
          kind: "issue-comment",
          author: { login: "author-raw", name: null, avatarUrl: null },
          body: "Raw comment 原文 /tmp/raw",
          createdAt: "2026-10-09T12:00:00Z",
          url: "https://github.com/acme/raw/issues/101#issuecomment-raw",
          path: null,
          reviewState: null,
          reactions: [],
        },
      ],
    };
    await act(async () =>
      root.render(
        tab === "summary" ? (
          <PullRequestSummaryTab
            environmentId={environmentId}
            threadRef={null}
            reference={reference}
            detail={value}
            activityPending={false}
            activityError={null}
            onRefresh={() => {}}
          />
        ) : (
          <PullRequestTimelineTab
            environmentId={environmentId}
            reference={reference}
            detail={value}
            order="newest"
            onOpenCommit={() => {}}
            onRefresh={() => {}}
          />
        ),
      ),
    );
    expect(container.textContent).toContain("1d ago");
    if (tab === "timeline") {
      await act(async () => {
        container.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click();
      });
    }
    await act(async () => changeLanguage("zh"));
    expect(container.textContent).toContain("1天前");
    expect(container.textContent).not.toContain("1d ago");
    expect(container.textContent).toContain("Raw comment 原文 /tmp/raw");
    expect(container.textContent).toContain("author-raw");
    await act(async () => changeLanguage("en"));
    expect(container.textContent).toContain("1d ago");
    expect(container.textContent).toContain("Raw comment 原文 /tmp/raw");
  },
);

it("updates list dates when the language changes while retaining the raw row", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
  await act(async () =>
    root.render(
      <PullRequestRowLines number="#101" title="Raw title 原文" updatedAt="2026-10-10T06:00:00Z" />,
    ),
  );
  expect(container.textContent).toContain("6h ago");
  await act(async () => changeLanguage("zh"));
  expect(container.textContent).toContain("6小时前");
  expect(container.textContent).not.toContain("6h ago");
  expect(container.textContent).toContain("#101Raw title 原文");
  await act(async () => changeLanguage("en"));
  expect(container.textContent).toContain("6h ago");
});

it("translates the shared inline composer defaults while keeping its draft and submitted text", async () => {
  const onComment = vi.fn();
  await act(async () =>
    root.render(
      <DiffCommentAnnotation
        kind="draft"
        rangeLabel="src/raw.ts:1"
        text=""
        focusOnMount={false}
        onCancel={() => {}}
        onComment={onComment}
      />,
    ),
  );
  const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
  expect(textarea.placeholder).toBe("Add a comment…");
  await input(textarea, "  Inline 原文 /tmp/raw  ");
  await act(async () => changeLanguage("zh"));
  expect(textarea.placeholder).toBe("添加评论…");
  expect(textarea.getAttribute("aria-label")).toBe("为 src/raw.ts:1 添加评论");
  expect(textarea.value).toBe("  Inline 原文 /tmp/raw  ");
  await click("评论");
  expect(onComment).toHaveBeenCalledExactlyOnceWith("Inline 原文 /tmp/raw");
  await act(async () => changeLanguage("en"));
  expect(textarea.placeholder).toBe("Add a comment…");
  expect(textarea.value).toBe("  Inline 原文 /tmp/raw  ");
});

it("keeps separate comment and review drafts across mode and language changes", async () => {
  await act(async () =>
    root.render(
      <PullRequestComposer
        environmentId={environmentId}
        reference={reference}
        detail={detail}
        actionPending={false}
        onCommentAction={fixture.onCommentAction}
        onCommented={fixture.onCommented}
        onReviewSubmitted={fixture.onSubmitted}
      />,
    ),
  );
  await click("Comment on pull request");
  await input(
    document.querySelector<HTMLTextAreaElement>('[aria-label="Comment on this pull request"]')!,
    "Comment 原文 /tmp/raw",
  );
  await click("Review");
  await input(
    document.querySelector<HTMLTextAreaElement>('[aria-label="Review summary"]')!,
    "Review 原文",
  );
  await act(async () => changeLanguage("zh"));
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="审阅摘要"]')!.value).toBe(
    "Review 原文",
  );
  await click("评论");
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="评论此拉取请求"]')!.value).toBe(
    "Comment 原文 /tmp/raw",
  );
  expect(fixture.post).not.toHaveBeenCalled();
  expect(fixture.review).not.toHaveBeenCalled();
});

it("reports a pending comment failure in the new language and keeps its input", async () => {
  const pending = deferred();
  fixture.post.mockReturnValue(pending.promise);
  await act(async () => root.render(<Comment />));
  await input(container.querySelector("textarea")!, " Comment 原文 ");
  await click("Comment");
  expect(fixture.post).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { ...reference, body: "Comment 原文" },
  });
  await act(async () => changeLanguage("zh"));
  expect(button("正在发布…").disabled).toBe(true);
  await act(async () =>
    pending.finish({ _tag: "Failure", cause: Cause.fail(new Error("Raw host failure")) }),
  );
  expect(fixture.toast).toHaveBeenCalledExactlyOnceWith({ type: "error", title: "无法发布评论" });
  expect(container.querySelector("textarea")!.value).toBe(" Comment 原文 ");
  expect(fixture.onClose).not.toHaveBeenCalled();
});

it("sends the original reopen action and text from the translated comment control", async () => {
  fixture.onCommentAction.mockResolvedValue({ commentPosted: true });
  await act(async () => root.render(<Comment state="closed" />));
  await input(container.querySelector("textarea")!, "Keep 原文");
  await act(async () => changeLanguage("zh"));
  await click("评论并重新打开");
  expect(fixture.onCommentAction).toHaveBeenCalledExactlyOnceWith("Keep 原文", "reopen");
  expect(container.querySelector("textarea")!.value).toBe("");
  expect(fixture.onClose).toHaveBeenCalledOnce();
});

it("keeps a failed required review and its verdict after a language change", async () => {
  const pending = deferred();
  fixture.review.mockReturnValue(pending.promise);
  await act(async () => root.render(<Review />));
  expect(button("Submit review").disabled).toBe(true);
  await input(container.querySelector("textarea")!, "Needs changes 原文");
  await click("Submit review");
  await act(async () => changeLanguage("zh"));
  await act(async () =>
    pending.finish({ _tag: "Failure", cause: Cause.fail(new Error("Raw host failure")) }),
  );
  expect(fixture.review).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { ...reference, verdict: "request-changes", body: "Needs changes 原文", comments: [] },
  });
  expect(fixture.toast).toHaveBeenCalledExactlyOnceWith({ type: "error", title: "无法提交审阅" });
  expect(container.querySelector("textarea")!.value).toBe("Needs changes 原文");
  expect(button("提交审阅").disabled).toBe(false);
});

it("uses the settled review language and leaves summary changes made during submission", async () => {
  const pending = deferred();
  fixture.review.mockReturnValue(pending.promise);
  await act(async () => root.render(<Review approve />));
  await input(container.querySelector("textarea")!, "Approved 原文");
  await click("Submit review");
  await input(container.querySelector("textarea")!, "New draft 原文");
  await act(async () => changeLanguage("zh"));
  await act(async () => pending.finish({ _tag: "Success" }));
  expect(fixture.toast).toHaveBeenCalledExactlyOnceWith({
    type: "success",
    title: "拉取请求已获批准",
  });
  expect(usePullRequestReviewStore.getState().summaries[pullRequestReviewKey(reference)]).toBe(
    "New draft 原文",
  );
  expect(fixture.onSubmitted).toHaveBeenCalledOnce();
});

it("preserves markdown edits and preview mode through locale changes and saves the original text", async () => {
  const save = vi.fn();
  await act(async () =>
    root.render(
      <PullRequestMarkdownEditor
        value="Original"
        cwd="/repo"
        environmentId={environmentId}
        label="Description"
        saving={false}
        onSave={save}
        onCancel={() => {}}
      />,
    ),
  );
  await input(container.querySelector("textarea")!, "**Keep 原文** /tmp/raw");
  await click("Preview");
  await act(async () => changeLanguage("zh"));
  expect(container.querySelector("article")!.textContent).toBe("**Keep 原文** /tmp/raw");
  expect(button("预览").getAttribute("aria-pressed")).toBe("true");
  await click("保存");
  expect(save).toHaveBeenCalledExactlyOnceWith("**Keep 原文** /tmp/raw");
});

it("keeps a label query and reports the raw named mutation in the settled language", async () => {
  const pending = deferred();
  fixture.labels.mockReturnValue(pending.promise);
  await act(async () =>
    root.render(
      <PullRequestLabelPicker environmentId={environmentId} reference={reference} allowed />,
    ),
  );
  await click("Change labels");
  await input(document.querySelector<HTMLInputElement>('[aria-label="Search labels"]')!, "bug");
  const candidate = document.querySelector<HTMLElement>('[role="option"]')!;
  await act(async () => candidate.click());
  await act(async () => changeLanguage("zh"));
  expect(document.querySelector<HTMLInputElement>('[aria-label="搜索标签"]')!.value).toBe("bug");
  await act(async () =>
    pending.finish({ _tag: "Failure", cause: Cause.fail(new Error("Raw label failure")) }),
  );
  expect(fixture.labels).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { ...reference, labels: ["bug 原文"], applied: true },
  });
  expect(fixture.toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: "无法添加标签 bug 原文" }),
  );
});

it("withdraws a team review request using its original id and reports success in the new language", async () => {
  const pending = deferred();
  fixture.reviewers.mockReturnValue(pending.promise);
  await act(async () =>
    root.render(
      <PullRequestReviewerPicker environmentId={environmentId} reference={reference} allowed />,
    ),
  );
  await click("Request a review");
  await act(async () => document.querySelector<HTMLElement>('[role="option"]')!.click());
  await act(async () => changeLanguage("zh"));
  expect(document.body.textContent).toContain("团队");
  await act(async () => pending.finish({ _tag: "Success" }));
  expect(fixture.reviewers).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { ...reference, reviewers: [{ id: "team-raw", kind: "team" }], requested: false },
  });
  expect(fixture.toast).toHaveBeenCalledExactlyOnceWith({
    type: "success",
    title: "已撤回向 acme/原文 发出的审阅请求",
  });
});
