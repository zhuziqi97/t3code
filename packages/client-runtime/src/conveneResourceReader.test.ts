import { expect, it } from "vite-plus/test";
import type { ConveneResourceReadResult } from "@t3tools/contracts";
import {
  createConveneResourceReader,
  type ConveneResourceReaderState,
} from "./conveneResourceReader.ts";

const ready = (uri: string, number = 1): ConveneResourceReadResult => ({
  status: "ready",
  resource_uri: uri,
  web_path: "/issue",
  web_url: "http://platform/issue",
  issue: { number: 1, title: "Title", body: "Body", state: "OPEN", resource_uri: uri },
  comments: [
    {
      number,
      resource_uri: `${uri}/comments/${number}`,
      body: `Comment ${number}`,
      is_deleted: false,
      created_at: "2026-10-23",
    },
  ],
  focused_comment_number: null,
  page: number,
  page_size: 1,
  total: 2,
});

const document = (
  uri: string,
  startLine = 1,
  id = "node-1",
  version = 1,
): Extract<ConveneResourceReadResult, { document: unknown }> => ({
  status: "ready",
  resource_uri: uri,
  web_path: "/document",
  web_url: "http://platform/document",
  document: { id, title: "Notes", version, mime_type: null },
  content: startLine === 1 ? "First\r\nSecond\n" : "Last",
  slice: {
    start_line: startLine,
    end_line: startLine === 1 ? 2 : 3,
    returned_lines: startLine === 1 ? 2 : 1,
    total_lines: 3,
    has_more_before: startLine > 1,
    has_more_after: startLine === 1,
    next_start_line: startLine === 1 ? 3 : null,
    truncated: true,
  },
});

it("discards old environment results and clears content on permission invalidation", async () => {
  const pending = Promise.withResolvers<ConveneResourceReadResult>();
  let state: ConveneResourceReaderState | undefined;
  const reader = createConveneResourceReader(
    (uri) => (uri === "old" ? pending.promise : Promise.resolve(ready(uri))),
    (value) => {
      state = value;
    },
  );
  const old = reader.load("old");
  await reader.load("new");
  pending.resolve(ready("old"));
  await old;
  expect(state?.result?.resource_uri).toBe("new");
  reader.clear();
  expect(state?.result).toBeNull();
  const lateWindow = Promise.withResolvers<ConveneResourceReadResult>();
  const documentReader = createConveneResourceReader(
    (uri, _page, startLine) =>
      startLine === 3 ? lateWindow.promise : Promise.resolve(document(uri)),
    (value) => {
      state = value;
    },
  );
  await documentReader.load("old-document");
  const nextWindow = documentReader.load("old-document", 1, 3);
  documentReader.clear();
  await documentReader.load("new-document");
  lateWindow.resolve(document("old-document", 3));
  await nextWindow;
  expect(state?.result?.resource_uri).toBe("new-document");
});

it("replaces visible data on denied refresh and does not keep a cached authorized body", async () => {
  let denied = false;
  let state: ConveneResourceReaderState | undefined;
  const reader = createConveneResourceReader(
    async (uri) => (denied ? { status: "unauthorized", resource_uri: uri } : ready(uri)),
    (value) => {
      state = value;
    },
  );
  await reader.load("issue");
  denied = true;
  await reader.load("issue");
  expect(state?.result?.status).toBe("unauthorized");
  expect(state?.result).not.toHaveProperty("issue");
  denied = false;
  const documentReader = createConveneResourceReader(
    async (uri, _page, startLine) =>
      denied ? { status: "unauthorized", resource_uri: uri } : document(uri, startLine),
    (value) => {
      state = value;
    },
  );
  await documentReader.load("document");
  denied = true;
  await documentReader.load("document", 1, 3);
  expect(state?.result).toEqual({ status: "unauthorized", resource_uri: "document" });
});

it("appends comments only for the same canonical resource and reports transport failures", async () => {
  let state: ConveneResourceReaderState | undefined;
  const reader = createConveneResourceReader(
    async (uri, page) => {
      if (uri === "offline") throw new Error("offline");
      return ready(uri, page);
    },
    (value) => {
      state = value;
    },
  );
  await reader.load("issue");
  await reader.load("issue", 2);
  expect(
    state?.result?.status === "ready" &&
      "issue" in state.result &&
      state.result.comments.map((c) => c.number),
  ).toEqual([1, 2]);
  await reader.load("other");
  expect(
    state?.result?.status === "ready" &&
      "issue" in state.result &&
      state.result.comments.map((c) => c.number),
  ).toEqual([1]);
  await reader.load("offline");
  expect(state?.result?.status).toBe("unavailable");

  let id = "node-1";
  let version = 1;
  const calls: Array<number | undefined> = [];
  const documentReader = createConveneResourceReader(
    async (uri, _page, startLine) => {
      calls.push(startLine);
      return document(uri, startLine, id, version);
    },
    (value) => {
      state = value;
    },
  );
  await documentReader.load("document");
  await documentReader.load("document", 1, 3);
  expect(calls).toEqual([undefined, 3]);
  expect(state?.result).toMatchObject({
    content: "First\r\nSecond\nLast",
    slice: {
      start_line: 1,
      end_line: 3,
      returned_lines: 3,
      next_start_line: null,
      truncated: false,
    },
  });
  for (const change of ["version", "id"] as const) {
    await documentReader.load("document");
    if (change === "version") version++;
    else id = "replacement-node";
    await documentReader.load("document", 1, 3);
    expect(state?.needsRefresh).toBe(true);
    expect(state?.result).toHaveProperty("content", "First\r\nSecond\n");
    const sent = calls.length;
    await documentReader.load("document", 1, 3);
    expect(calls).toHaveLength(sent);
    await documentReader.load("document");
    expect(calls.at(-1)).toBeUndefined();
    expect(state?.needsRefresh).toBe(false);
    expect(state?.result).toHaveProperty("document", {
      id,
      title: "Notes",
      version,
      mime_type: null,
    });
  }
  const empty = {
    ...document("empty"),
    content: "",
    slice: {
      start_line: 1,
      end_line: null,
      returned_lines: 0,
      total_lines: 0,
      has_more_before: false,
      has_more_after: false,
      next_start_line: null,
      truncated: false,
    },
  };
  await createConveneResourceReader(
    async () => empty,
    (value) => {
      state = value;
    },
  ).load("empty");
  expect(state?.result).toEqual(empty);
  expect(state?.needsRefresh).toBe(false);
});

it("keeps existing comments mounted during pagination but clears them on permission invalidation", async () => {
  const pending = Promise.withResolvers<ConveneResourceReadResult>();
  let state: ConveneResourceReaderState | undefined;
  const reader = createConveneResourceReader(
    (uri, page) => (page === 1 ? Promise.resolve(ready(uri)) : pending.promise),
    (value) => {
      state = value;
    },
  );
  await reader.load("issue");
  const nextPage = reader.load("issue", 2);
  expect(state?.pending).toBe(true);
  expect(
    state?.result?.status === "ready" &&
      "issue" in state.result &&
      state.result.comments.map((c) => c.number),
  ).toEqual([1]);
  reader.clear();
  pending.resolve(ready("issue", 2));
  await nextPage;
  expect(state?.result).toBeNull();
});
