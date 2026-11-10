import { describe, expect, it } from "vite-plus/test";

import { subagentThreadTitle, withExecutedModelNote } from "./subagentProjection.ts";

describe("subagentThreadTitle", () => {
  it("clips a long prompt without splitting a surrogate pair", () => {
    const title = (prompt: string) =>
      subagentThreadTitle({ parentTitle: "Parent", prompt, ordinal: 1 });

    expect(title(`${"a".repeat(68)}😀 and more work.`)).toBe(`${"a".repeat(68)}...`);
    expect(title(`${"a".repeat(67)}😀 and more work.`)).toBe(`${"a".repeat(67)}😀...`);
  });
});

it.each([
  { requested: null, executed: "native-model", expected: "Result" },
  { requested: "same-model", executed: "same-model", expected: "Result" },
  { requested: "requested-model", executed: null, expected: "Result" },
  {
    requested: "requested-model",
    executed: "actual-model",
    expected:
      "Requested model requested-model; the provider reported running actual-model.\n\nResult",
  },
])("reports model substitution only for an explicit selection: $requested/$executed", (row) => {
  expect(withExecutedModelNote("Result", row.requested, row.executed)).toBe(row.expected);
});
