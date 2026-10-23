import type { ScopedThreadRef } from "@t3tools/contracts";
import { ProjectReadFileError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { createI18n } from "@t3tools/client-runtime/i18n";

import { remapFileCommentAnnotations } from "./fileCommentAnnotations";
import {
  filePreviewReadErrorMessage,
  formatFilePreviewErrorMessage,
  resolveFilePreviewPath,
  setMarkdownTaskChecked,
  shouldShowFileExplorer,
  workspaceAssetResource,
} from "./filePreviewMode";

const decodeReadError = Schema.decodeSync(ProjectReadFileError);

describe("file preview read errors", () => {
  // regression: #15628 read errors from servers without attempted paths keep their own message
  it("preserves the public message from older servers", () => {
    const error = decodeReadError({
      _tag: "ProjectReadFileError",
      message: "Legacy file read failure.",
    });
    expect(filePreviewReadErrorMessage(error)).toBe("Legacy file read failure.");
  });

  it("uses the failure code in Chinese and keeps unrecognized diagnostics verbatim", () => {
    const zh = createI18n({ lng: "zh" }).t;
    const error = new ProjectReadFileError({
      cwd: "/原始项目",
      relativePath: "raw.bin",
      failure: "binary_file",
      operation: "read",
    });
    expect(filePreviewReadErrorMessage(error, zh)).toBe("这是二进制文件，无法以文本显示。");
    expect(error.relativePath).toBe("raw.bin");
    expect(
      formatFilePreviewErrorMessage(
        "This file is not UTF-8 text. Open it in another app to view its contents.",
        zh,
      ),
    ).toBe("此文件不是 UTF-8 文本，请使用其他应用查看内容。");
    expect(formatFilePreviewErrorMessage("EACCES: /原始项目/raw.bin", zh)).toBe(
      "EACCES: /原始项目/raw.bin",
    );
  });
});

describe("file comment annotations", () => {
  it("keeps an annotation range attached when Pierre remaps its anchor line", () => {
    expect(
      remapFileCommentAnnotations([
        {
          lineNumber: 20,
          metadata: {
            entries: [
              {
                id: "comment-1",
                kind: "comment",
                startLine: 7,
                endLine: 16,
                text: "Keep this guarded.",
              },
            ],
          },
        },
      ]),
    ).toEqual([
      {
        lineNumber: 20,
        metadata: {
          entries: [
            {
              id: "comment-1",
              kind: "comment",
              startLine: 11,
              endLine: 20,
              text: "Keep this guarded.",
            },
          ],
        },
      },
    ]);
  });
});

describe("setMarkdownTaskChecked", () => {
  const markdown = "- [ ] First\n- [x] Second\n";

  it("checks and unchecks the task marker at the supplied offset", () => {
    expect(setMarkdownTaskChecked(markdown, 2, true)).toBe("- [x] First\n- [x] Second\n");
    expect(setMarkdownTaskChecked(markdown, 14, false)).toBe("- [ ] First\n- [ ] Second\n");
    expect(setMarkdownTaskChecked("1. [X] Ordered\n", 3, false)).toBe("1. [ ] Ordered\n");
  });

  it("leaves the document unchanged for a stale or invalid marker offset", () => {
    expect(setMarkdownTaskChecked(markdown, 0, true)).toBe(markdown);
    expect(setMarkdownTaskChecked(markdown, 200, true)).toBe(markdown);
  });
});

describe("resolveFilePreviewPath", () => {
  it.each([
    ["/repo/project", null],
    ["/repo/project/", null],
    [".", null],
    [null, null],
    ["/repo/project/src", "/repo/project/src"],
    ["/repo/project/src/main.ts", "/repo/project/src/main.ts"],
    ["src/main.ts", "src/main.ts"],
    ["/repo/project-other", "/repo/project-other"],
  ])("opens %s in the appropriate workspace surface", (path, expected) => {
    const relativePath = resolveFilePreviewPath(path, "/repo/project");
    expect(relativePath).toBe(expected);
    if (expected === null) {
      expect(
        shouldShowFileExplorer({ relativePath, explorerOpen: false, attachmentOpen: false }),
      ).toBe(true);
    }
  });
});

describe("workspaceAssetResource", () => {
  const input = {
    kind: "workspace-file" as const,
    threadRef: {
      environmentId: "env" as ScopedThreadRef["environmentId"],
      threadId: "thread-1" as ScopedThreadRef["threadId"],
    },
    workspaceRoot: "/repo",
    absolutePath: "/repo/docs/index.html",
  };

  it("names the workspace root for a draft, which the server cannot resolve from a thread", () => {
    expect(workspaceAssetResource({ ...input, draft: true })).toEqual({
      _tag: "draft-workspace-file",
      cwd: "/repo",
      path: "/repo/docs/index.html",
    });
  });
});
