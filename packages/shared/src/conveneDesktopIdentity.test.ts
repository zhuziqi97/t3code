import { describe, expect, it } from "vite-plus/test";
import { resolveConveneVersion } from "./conveneDesktopIdentity.ts";

describe("Convene candidate identity", () => {
  it.each(["1.2.3", "1.2.3-alpha"])(
    "does not append a second suffix to an issued %s candidate",
    (base) => {
      const candidate = resolveConveneVersion(base);
      expect(resolveConveneVersion(candidate)).toBe(candidate);
    },
  );

  it("preserves the explicit candidate written by the release flow", () => {
    expect(resolveConveneVersion("1.2.3-9")).toBe("1.2.3-9");
  });
});
