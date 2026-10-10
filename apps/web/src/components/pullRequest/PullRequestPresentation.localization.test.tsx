// @vitest-environment jsdom
import type { EnvironmentId, ProjectId, PullRequestCheck } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { changeLanguage, i18n } from "~/i18n";
import { PullRequestChecksPopover } from "./PullRequestChecksPopover";
import { PullRequestDetailGhost } from "./PullRequestGhosts";
import { PullRequestCopyableCode } from "./PullRequestCopyableCode";
import {
  PullRequestActorLabel,
  PullRequestConflictGlyph,
  PullRequestReviewDecisionGlyph,
  PullRequestReviewOutcomeBadge,
  PullRequestStateGlyph,
  summarizePullRequestChecks,
} from "./pullRequestPresentation";

const { openLink, addToast, query } = vi.hoisted(() => ({
  openLink: vi.fn(),
  addToast: vi.fn(),
  query: { data: null, isPending: true, error: null as string | null },
}));
vi.mock("~/browser/useOpenLink", () => ({ useOpenLink: () => openLink }));
vi.mock("~/state/query", () => ({ useEnvironmentQuery: () => query }));
vi.mock("~/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copyToClipboard: vi.fn(), isCopied: true }),
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: addToast } }));

let root: Root;
let container: HTMLDivElement;
const check = (
  status: PullRequestCheck["status"],
  url: string | null = null,
): PullRequestCheck => ({
  status,
  url,
  name: `check-${status} 原文`,
  description: "Raw diagnostic 原文",
});
async function click(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.trim() === text,
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
async function openChecks() {
  await act(async () => container.querySelector<HTMLElement>('[role="button"]')!.click());
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
  openLink.mockReset();
  addToast.mockReset();
  query.data = null;
  query.isPending = true;
  query.error = null;
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
});

it("changes lifecycle, conflict and review signals without translating branch or actor identities", async () => {
  await act(async () =>
    root.render(
      <>
        <PullRequestStateGlyph state="merged" isDraft />
        <PullRequestConflictGlyph
          state="open"
          isDraft={false}
          mergeability="conflicting"
          baseBranch="release/原文"
        />
        <PullRequestReviewDecisionGlyph decision="review-required" />
        <PullRequestReviewOutcomeBadge outcome="changes-requested" />
        <PullRequestActorLabel
          actor={{ login: "octocat-raw", name: null, avatarUrl: null }}
          profileUrl="https://github.com/octocat-raw"
        />
      </>,
    ),
  );
  expect(container.querySelector('[aria-label="Merged"]')).not.toBeNull();
  await act(async () => changeLanguage("zh"));
  expect(container.querySelector('[aria-label="已合并"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="与 release/原文 有冲突"]')).not.toBeNull();
  expect(container.textContent).toContain("等待审阅");
  expect(container.textContent).toContain("要求修改");
  expect(container.querySelector("a")?.getAttribute("aria-label")).toBe(
    "打开 octocat-raw 的个人主页",
  );
  expect(container.querySelector("a")?.href).toBe("https://github.com/octocat-raw");
});

it("keeps an expanded checks list while changing language and preserves its host details", async () => {
  const checks = [check("pending"), check("success"), check("skipped")];
  await act(async () =>
    root.render(<PullRequestChecksPopover checksState="pending" checks={checks} />),
  );
  await openChecks();
  expect(document.body.textContent).not.toContain("check-success 原文");
  await click("Show all");
  await act(async () => changeLanguage("zh"));
  expect(document.body.textContent).toContain("3 项检查中有 1 项运行中");
  expect(document.body.textContent).toContain("check-success 原文");
  expect(document.body.textContent).toContain("已跳过");
  await click("收起");
  expect(document.body.textContent).not.toContain("check-success 原文");
  expect(document.body.textContent).toContain("check-pending 原文");
});

it("uses the language at settlement when opening check details fails", async () => {
  let reject!: (error: unknown) => void;
  openLink.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const url = "https://github.com/acme/raw/actions/runs/42";
  await act(async () =>
    root.render(
      <PullRequestChecksPopover checksState="pending" checks={[check("action-required", url)]} />,
    ),
  );
  await openChecks();
  await click("Details");
  expect(openLink).toHaveBeenCalledExactlyOnceWith(url);
  await act(async () => changeLanguage("zh"));
  const diagnostic = new Error("Raw host diagnostic 原文");
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await act(async () => reject(diagnostic));
  } finally {
    consoleError.mockRestore();
  }
  expect(addToast).toHaveBeenCalledExactlyOnceWith({ type: "error", title: "无法打开检查详情" });
  expect(document.body.textContent).toContain("等待批准");
});

it("translates lazy loading, empty and raw failure states through the actual popover", async () => {
  const props = {
    checksState: "pending" as const,
    environmentId: "env-qa" as EnvironmentId,
    reference: { projectId: "project-qa" as ProjectId, repository: "acme/raw", number: 42 },
  };
  await act(async () => root.render(<PullRequestChecksPopover {...props} />));
  await openChecks();
  await act(async () => changeLanguage("zh"));
  expect(document.body.textContent).toContain("正在加载检查…");
  query.isPending = false;
  await act(async () => root.render(<PullRequestChecksPopover {...props} />));
  expect(document.body.textContent).toContain("暂无检查结果");
  query.error = "Raw host failure 原文";
  await act(async () => root.render(<PullRequestChecksPopover {...props} />));
  expect(document.body.textContent).toContain(query.error);
});

it("keeps the current loading tab and copied code when their labels change", async () => {
  await act(async () =>
    root.render(
      <>
        <PullRequestDetailGhost activeTab="timeline" number={42} />
        <PullRequestCopyableCode
          value="feature/原文"
          target="branch name"
          copyLabel="Copy"
          copiedLabel="Done"
        />
      </>,
    ),
  );
  await act(async () => changeLanguage("zh"));
  expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
    "正在加载拉取请求",
  );
  const timeline = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "时间线",
  );
  expect(timeline?.getAttribute("aria-pressed")).toBe("true");
  expect(container.textContent).toContain("feature/原文");
  expect(container.textContent).toContain("已复制");
});

it("distinguishes approvals, manual action and neutral results with complete bilingual summaries", async () => {
  const workflow = check("action-required", "https://github.com/acme/raw/actions/runs/42");
  const gate = check("action-required", "https://example.test/manual-gate");
  expect(summarizePullRequestChecks([workflow, workflow, gate])).toBe(
    "2 workflows and 1 check awaiting action",
  );
  expect(summarizePullRequestChecks([workflow, gate, gate])).toBe(
    "1 workflow and 2 checks awaiting action",
  );
  await changeLanguage("zh");
  expect(summarizePullRequestChecks([workflow, gate], i18n.t)).toBe(
    "1 个工作流和 1 项检查等待处理",
  );
  expect(summarizePullRequestChecks([check("success"), check("neutral")], i18n.t)).toBe(
    "2 项检查中有 1 项通过",
  );
  expect(summarizePullRequestChecks([check("failure"), workflow], i18n.t)).toBe(
    "2 项检查中有 1 项失败",
  );
  expect(summarizePullRequestChecks([workflow], i18n.t)).toBe("1 个工作流等待批准");
});
