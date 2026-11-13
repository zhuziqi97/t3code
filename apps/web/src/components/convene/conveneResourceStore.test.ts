import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, type ConveneResourceReadResult } from "@t3tools/contracts";
import type { ConveneResourceSurface } from "../../rightPanelStore";
import * as resources from "./conveneResourceStore";

const sourceThreadRef = {
  environmentId: EnvironmentId.make("env-a"),
  threadId: ThreadId.make("thread-a"),
};
const document = {
  id: "convene-resource:document" as const,
  kind: "convene-resource" as const,
  sourceThreadRef,
  uri: "convene://docs/owner/project/module/README.md",
};
const issue = {
  ...document,
  id: "convene-resource:issue" as const,
  uri: "convene://issues/owner/project/module/42",
};
const page = (uri: string, startLine = 1): ConveneResourceReadResult => ({
  status: "ready",
  resource_uri: uri,
  web_path: "/document",
  web_url: "https://platform/document",
  document: { id: "node-1", title: "Notes", version: 1, mime_type: "text/markdown" },
  content: startLine === 1 ? "First\n" : "Last",
  slice: {
    start_line: startLine,
    end_line: startLine,
    returned_lines: 1,
    total_lines: 2,
    has_more_before: startLine > 1,
    has_more_after: startLine === 1,
    next_start_line: startLine === 1 ? 2 : null,
    truncated: startLine === 1,
  },
});

const comments = (uri: string, page: number): ConveneResourceReadResult => ({
  status: "ready",
  resource_uri: uri,
  web_path: "/issue",
  web_url: "https://platform/issue",
  issue: { number: 42, title: "Issue", state: "OPEN", body: "Issue body", resource_uri: uri },
  comments: [
    {
      number: page,
      resource_uri: `${uri}/comments/${page}`,
      body: `Comment ${page}`,
      is_deleted: false,
      created_at: "2026-11-13",
    },
  ],
  focused_comment_number: null,
  page,
  page_size: 1,
  total: 2,
});

it("retains independent loaded windows and scroll until close, isolating a reopened session from late results", async () => {
  let resolvePending!: (value: ConveneResourceReadResult) => void;
  const pending = new Promise<ConveneResourceReadResult>((resolve) => {
    resolvePending = resolve;
  });
  let delayed = false;
  const read = vi.fn(async (target: ConveneResourceSurface, pageNumber: number, line?: number) =>
    delayed
      ? pending
      : target.id === issue.id
        ? comments(target.uri, pageNumber)
        : page(target.uri, line),
  );
  const store = resources.createConveneResourceStore(read, (_ref, changed) => {
    changed({ status: "ready", revision: 0 });
    return () => {};
  });
  store.getState().retain(document);
  await store.getState().load(document.id);
  await store.getState().load(document.id, 1, 2);
  store.getState().setScroll(document.id, 840);
  store.getState().retain(issue);
  await store.getState().load(issue.id);
  await store.getState().load(issue.id, 2);
  store.getState().setScroll(issue.id, 320);
  store.getState().retain(document);
  expect(store.getState().sessions[document.id]).toMatchObject({
    scrollTop: 840,
    state: { result: { content: "First\nLast", slice: { next_start_line: null } } },
  });
  expect(store.getState().sessions[issue.id]?.scrollTop).toBe(320);
  expect(read).toHaveBeenCalledTimes(4);
  expect(store.getState().sessions[issue.id]?.state.result).toMatchObject({
    comments: [{ number: 1 }, { number: 2 }],
    page: 2,
  });
  delayed = true;
  const old = store.getState().load(document.id);
  store.getState().release(document.id);
  store.getState().retain(document);
  resolvePending(page(document.uri));
  await old;
  expect(store.getState().sessions[document.id]).toMatchObject({
    scrollTop: 0,
    state: { result: null },
  });
  expect(store.getState().sessions[issue.id]?.scrollTop).toBe(320);
  store.getState().release(document.id);
  store.getState().release(issue.id);
});

it("clears a hidden session on access loss, discards pending data and reloads on restored access", async () => {
  let notify!: (access: resources.ConveneResourceAccess) => void;
  let resolvePending!: (value: ConveneResourceReadResult) => void;
  const pending = new Promise<ConveneResourceReadResult>((resolve) => {
    resolvePending = resolve;
  });
  let delayed = false;
  const stop = vi.fn();
  const read = vi.fn(async () => (delayed ? pending : page(document.uri)));
  const store = resources.createConveneResourceStore(read, (_ref, changed) => {
    notify = changed;
    changed({ status: "ready", revision: 0 });
    return stop;
  });
  store.getState().retain(document);
  await store.getState().load(document.id);
  store.getState().setScroll(document.id, 500);
  delayed = true;
  const old = store.getState().load(document.id, 1, 2);
  notify({ status: "unauthorized", revision: 1 });
  expect(store.getState().sessions[document.id]).toMatchObject({
    access: { status: "unauthorized" },
    scrollTop: 0,
    state: { result: null, pending: false },
  });
  resolvePending(page(document.uri, 2));
  await old;
  expect(store.getState().sessions[document.id]?.state.result).toBeNull();
  notify({ status: "disconnected", revision: 1 });
  expect(store.getState().sessions[document.id]?.access.status).toBe("disconnected");
  delayed = false;
  let resolveRestored!: () => void;
  const restored = new Promise<void>((resolve) => {
    resolveRestored = resolve;
  });
  const unsubscribe = store.subscribe((state) => {
    if (state.sessions[document.id]?.state.result?.status === "ready") resolveRestored();
  });
  notify({ status: "ready", revision: 1 });
  await restored;
  unsubscribe();
  expect(store.getState().sessions[document.id]?.state.result).toMatchObject({
    content: "First\n",
  });
  store.getState().release(document.id);
  expect(stop).toHaveBeenCalledOnce();
});
