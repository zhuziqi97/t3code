import { expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, type ConveneResourceSearchResult } from "@t3tools/contracts";
import {
  conveneComposerTarget,
  createConveneComposerSearch,
  sameConveneComposerTarget,
  serializeConveneComposerItem,
  type ConveneComposerSearchState,
} from "./conveneComposer.ts";

const target = {
  environmentId: EnvironmentId.make("env-a"),
  projectId: ProjectId.make("project-a"),
  kind: "issue" as const,
  query: "47",
};
const ready: ConveneResourceSearchResult = {
  status: "ready",
  items: [
    {
      kind: "issue",
      module_id: "module",
      module_path: "owner/project/module",
      title: "A [title]",
      resource_uri: "convene://issues/owner/project/module/47",
      number: 47,
      state: "OPEN",
    },
  ],
  total: 21,
  page: 1,
  page_size: 20,
};

it("maps existing triggers without changing PR, path or provider command syntax", () => {
  expect(
    conveneComposerTarget(target.environmentId, target.projectId, {
      kind: "pull-request",
      query: " 47 ",
    }),
  ).toEqual(target);
  expect(
    conveneComposerTarget(target.environmentId, target.projectId, { kind: "path", query: "readme" })
      ?.kind,
  ).toBe("document");
  expect(
    conveneComposerTarget(target.environmentId, target.projectId, {
      kind: "skill",
      query: "convene",
    })?.kind,
  ).toBe("guideline");
  expect(conveneComposerTarget(null, target.projectId, { kind: "path", query: "" })).toBeNull();
  expect(
    conveneComposerTarget(target.environmentId, target.projectId, {
      kind: "slash-command",
      query: "plan",
    }),
  ).toBeNull();
});

it("sends only the canonical reference and never claims a local provider skill", () => {
  if (ready.status !== "ready") throw new Error("fixture");
  const text = serializeConveneComposerItem({
    type: "convene-resource",
    resource: ready.items[0]!,
  });
  expect(text).toBe("[Convene #47 · A \\[title\\]](<convene://issues/owner/project/module/47>) ");
  expect(serializeConveneComposerItem({ type: "convene-guideline" })).toContain(
    "get_platform_guideline",
  );
  expect(serializeConveneComposerItem({ type: "convene-guideline" })).not.toContain("$Convene");
});

it("rejects a late project response and clears old results while changing page", async () => {
  const delayed = Promise.withResolvers<ConveneResourceSearchResult>();
  let state: ConveneComposerSearchState | undefined;
  const search = createConveneComposerSearch(
    (input) => (input.projectId === target.projectId ? delayed.promise : Promise.resolve(ready)),
    (value) => {
      state = value;
    },
  );
  const old = search.load(target);
  const other = { ...target, projectId: ProjectId.make("project-b") };
  await search.load(other, 2);
  delayed.resolve({ status: "unauthorized" });
  await old;
  expect(state?.target).toEqual(other);
  expect(state?.result?.status).toBe("ready");
  expect(state?.page).toBe(2);
  expect(sameConveneComposerTarget(state?.target ?? null, target)).toBe(false);
  search.clear();
  expect(state?.result).toBeNull();
});

it("clears metadata immediately and discards permission-invalidated replies", async () => {
  const delayed = Promise.withResolvers<ConveneResourceSearchResult>();
  let state: ConveneComposerSearchState | undefined;
  const search = createConveneComposerSearch(
    () => delayed.promise,
    (value) => {
      state = value;
    },
  );
  const request = search.load(target);
  expect(state?.result).toBeNull();
  search.clear();
  delayed.resolve(ready);
  await request;
  expect(state?.target).toBeNull();
  expect(state?.result).toBeNull();
});

it("preserves denial, normal empty results, and transport failure as different states", async () => {
  let state: ConveneComposerSearchState | undefined;
  const search = createConveneComposerSearch(
    async (_, page) => {
      if (page === 1) return { ...ready, items: [], total: 0 };
      if (page === 2) return { status: "scopeInsufficient" };
      throw new Error("offline");
    },
    (value) => {
      state = value;
    },
  );
  await search.load(target);
  expect(state?.result).toMatchObject({ status: "ready", items: [], total: 0 });
  await search.load(target, 2);
  expect(state?.result?.status).toBe("scopeInsufficient");
  await search.load(target, 3);
  expect(state?.result?.status).toBe("unavailable");
});
