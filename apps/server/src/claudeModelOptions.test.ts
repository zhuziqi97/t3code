import { describe, expect, it } from "@effect/vitest";

import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";

import {
  BUNDLED_CLAUDE_MODEL_CATALOG,
  scopeClaudeModelCatalog,
} from "./provider/ClaudeModelCatalog.ts";
import { compileClaudeModelSelection } from "./claudeModelOptions.ts";

const selection = (
  model: string | null,
  options: NonNullable<ModelSelection["options"]>,
): ModelSelection => ({
  instanceId: ProviderInstanceId.make("claude_test"),
  model,
  options,
});

describe("compileClaudeModelSelection", () => {
  it("scopes custom context allowances to the selected model", () => {
    const catalog = scopeClaudeModelCatalog(BUNDLED_CLAUDE_MODEL_CATALOG, [
      { slug: "native-custom-large", contextWindowTokens: 872000 },
      { slug: "native-custom-small", contextWindowTokens: 272000 },
    ]);
    expect(
      compileClaudeModelSelection(selection("native-custom-large", []), catalog).environment,
    ).toEqual({ CLAUDE_CODE_MAX_CONTEXT_TOKENS: "872000" });
    expect(
      compileClaudeModelSelection(selection("native-custom-small", []), catalog).environment,
    ).toEqual({ CLAUDE_CODE_MAX_CONTEXT_TOKENS: "272000" });
    expect(
      compileClaudeModelSelection(selection("native-unknown", []), catalog).environment,
    ).toEqual({});
    expect(compileClaudeModelSelection(selection(null, []), catalog).environment).toEqual({});
  });
  it.each(["sonnet", "anthropic/claude-opus-4-8", "gateway/CLAUDE-model", "gpt-model[1m]"])(
    "rejects custom capacity for native Claude ID %s",
    (model) => {
      const catalog = scopeClaudeModelCatalog(BUNDLED_CLAUDE_MODEL_CATALOG, [
        { slug: model, contextWindowTokens: 272000 },
      ]);
      expect(() => compileClaudeModelSelection(selection(model, []), catalog)).toThrow(
        /native context window/,
      );
    },
  );
  it("leaves default selection to Claude and preserves explicit custom parameters", () => {
    expect(compileClaudeModelSelection(selection(null, []))).toMatchObject({
      apiModelId: undefined,
      effort: undefined,
      settings: {},
    });
    expect(
      compileClaudeModelSelection(
        selection("my-native-model", [
          { id: "effort", value: "turbo" },
          { id: "fastMode", value: true },
          { id: "thinking", value: false },
        ]),
      ),
    ).toMatchObject({
      apiModelId: "my-native-model",
      effort: "turbo",
      settings: { fastMode: true, alwaysThinkingEnabled: false },
    });
  });
  it("compiles context, effort, and settings together", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-opus-4-6", [
          { id: "contextWindow", value: "1m" },
          { id: "effort", value: "max" },
          { id: "fastMode", value: true },
        ]),
      ),
    ).toMatchObject({
      apiModelId: "claude-opus-4-6[1m]",
      effort: "max",
      settings: { fastMode: true },
    });
  });

  it("compiles fast mode only for models that expose it", () => {
    expect(
      compileClaudeModelSelection(selection("claude-opus-4-6", [{ id: "fastMode", value: true }]))
        .settings,
    ).toEqual({ fastMode: true });
    expect(
      compileClaudeModelSelection(selection("claude-opus-4-6", [{ id: "fastMode", value: false }]))
        .settings,
    ).toEqual({ fastMode: false });
  });

  it("uses the model default SDK effort alongside prompt-injected effort", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-sonnet-4-6", [{ id: "effort", value: "ultrathink" }]),
      ),
    ).toMatchObject({ effort: "high", promptEffort: "ultrathink" });
  });

  it("keeps explicit effort for models missing from the local catalog", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-pool-model-not-in-catalog", [{ id: "effort", value: "max" }]),
      ).effort,
    ).toBe("max");
    expect(
      compileClaudeModelSelection(selection("claude-pool-model-not-in-catalog", [])).effort,
    ).toBeUndefined();
  });

  it("omits unsupported effort for models missing from the local catalog", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-pool-model-not-in-catalog", [{ id: "effort", value: "brutal" }]),
      ).effort,
    ).toBeUndefined();
  });

  it("compiles the thinking toggle for models that expose it", () => {
    expect(
      compileClaudeModelSelection(selection("claude-haiku-4-5", [{ id: "thinking", value: false }]))
        .settings,
    ).toEqual({ alwaysThinkingEnabled: false });
  });
});
