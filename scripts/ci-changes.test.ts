import { describe, expect, it } from "vite-plus/test";
import { decide, dependencyTests, readWorkspace } from "../.github/scripts/ci-changes.cjs";

describe("CI dependency and full-run selection", () => {
  it("runs the web-owned mobile stream bridge regression when its source changes", () => {
    const files = ["apps/mobile/src/features/browser/preview-stream.browser.ts"];
    expect(decide(files, readWorkspace(), false).outputs.test_web).toBe(true);
    expect(dependencyTests(files)).toEqual([
      "apps/web/src/browser/mobilePreviewStream.browser.test.ts",
    ]);
  });
  it("runs native mobile analysis for a full candidate without native source changes", () => {
    expect(decide(["docs/user/index.md"], readWorkspace(), true).outputs.mobile_native).toBe(true);
  });

  it("selects Pierre's real web behavior tests for patch-only changes", () => {
    expect(dependencyTests(["patches/@pierre%2Fdiffs@1.6.1.patch"])).toEqual([
      "apps/web/src/components/diffs/codeViewLocalization.browser.test.ts",
    ]);
    const { outputs } = decide(["patches/@pierre%2Fdiffs@1.6.1.patch"], readWorkspace(), false);
    expect(outputs.test_web).toBe(true);
    expect(outputs.typecheck).toBe(true);
    expect(outputs.build).toBe(true);
    expect(outputs.test_server).toBe(false);
  });

  it("keeps unknown patches on the full CI fallback", () => {
    const { outputs } = decide(["patches/some-new-dependency.patch"], readWorkspace(), false);
    expect(outputs.test_web).toBe(true);
    expect(outputs.test_server).toBe(true);
  });

  it("does not select Pierre behavior tests for unrelated source edits", () => {
    expect(dependencyTests(["apps/web/src/components/Sidebar.tsx"])).toEqual([]);
  });

  it("preserves native-mobile skipping for an unrelated PR", () => {
    expect(decide(["docs/user/index.md"], readWorkspace(), false).outputs.mobile_native).toBe(
      false,
    );
  });
});
