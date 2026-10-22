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
  expect(state?.result?.status === "ready" && state.result.comments.map((c) => c.number)).toEqual([
    1, 2,
  ]);
  await reader.load("other");
  expect(state?.result?.status === "ready" && state.result.comments.map((c) => c.number)).toEqual([
    1,
  ]);
  await reader.load("offline");
  expect(state?.result?.status).toBe("unavailable");
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
  expect(state?.result?.status === "ready" && state.result.comments.map((c) => c.number)).toEqual([
    1,
  ]);
  reader.clear();
  pending.resolve(ready("issue", 2));
  await nextPage;
  expect(state?.result).toBeNull();
});
