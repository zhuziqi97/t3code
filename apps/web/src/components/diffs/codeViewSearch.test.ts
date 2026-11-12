import { type CodeViewItem } from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import { describe, expect, it } from "vite-plus/test";

const searchUrl = new URL("./search/codeViewSearch.js", import.meta.resolve("@pierre/diffs"));
const { collectCodeViewLineMatches } = (await import(
  /* @vite-ignore */ searchUrl.href
)) as typeof import("../../../node_modules/@pierre/diffs/dist/search/codeViewSearch.js");

const { iterateOverDiff } = (await import(
  /* @vite-ignore */ new URL("./utils/iterateOverDiff.js", import.meta.resolve("@pierre/diffs"))
    .href
)) as typeof import("../../../node_modules/@pierre/diffs/dist/utils/iterateOverDiff.js");

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const keep = 1;
-const oldName = 2;
+const newName = 2;
+const added = oldName;
 const tail = 4;
@@ -20,3 +21,3 @@ function x() {
 ctx20 name
-del21 Name
+add22 names
 ctx22
diff --git a/src/b.ts b/src/b.ts
index 3333333..4444444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,1 +1,1 @@
-nil
+: nil
`;

const items: CodeViewItem<undefined>[] = parsePatchFiles(PATCH)[0]!.files.map(
  (fileDiff, index) => ({ id: `file-${index}`, type: "diff", fileDiff, collapsed: index === 1 }),
);

function find(
  text: string,
  flags: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean } = {},
) {
  const lines: Parameters<typeof collectCodeViewLineMatches>[0][number][] = [];
  for (const item of items) {
    if (item.type !== "diff") continue;
    iterateOverDiff({
      diff: item.fileDiff,
      diffStyle: "unified",
      expandedHunks: true,
      callback: ({ additionLine, deletionLine }) => {
        const line = additionLine ?? deletionLine;
        if (!line) return;
        const side = additionLine ? "additions" : "deletions";
        lines.push({
          text: item.fileDiff[additionLine ? "additionLines" : "deletionLines"][line.lineIndex]!,
          metadata: {
            itemId: item.id,
            itemType: "diff",
            side,
            lineNumber: line.lineNumber,
            lineIndex: line.lineIndex,
          },
        });
      },
    });
  }
  return collectCodeViewLineMatches(
    lines,
    {
      text,
      replaceText: "",
      caseSensitive: flags.caseSensitive ?? false,
      wholeWord: flags.wholeWord ?? false,
      regex: flags.regex ?? false,
    },
    100_000,
  ).map(
    ({ itemId, side, lineNumber, startCharacter, endCharacter }) =>
      `${itemId}:${side}:${lineNumber}:${startCharacter}-${endCharacter}`,
  );
}

describe("collectMatches", () => {
  it("finds removed, added, and context lines in render order, folded files included", () => {
    expect(find("oldName")).toEqual(["file-0:deletions:2:6-13", "file-0:additions:3:14-21"]);
    expect(find("nil")).toEqual(["file-1:deletions:1:0-3", "file-1:additions:1:2-5"]);
  });
});
