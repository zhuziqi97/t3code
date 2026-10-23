import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId, type ModelCapabilities } from "@t3tools/contracts";

import {
  applyClaudePromptEffortPrefix,
  buildExplicitProviderOptionSelectionsFromDescriptors,
  buildProviderOptionSelectionsFromDescriptors,
  createModelCapabilities,
  createModelSelection,
  getProviderOptionCurrentLabel,
  getProviderOptionDescriptors,
  readCustomModelEntries,
  mergeCustomModels,
  toCustomModelSetting,
  normalizeCustomModelSlug,
  normalizeModelSlug,
  modelSelectionsEqual,
} from "./model.ts";

const codexCaps: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "xhigh", label: "Extra High" },
        { id: "high", label: "High", isDefault: true },
      ],
      currentValue: "high",
    },
    {
      id: "fastMode",
      label: "Fast Mode",
      type: "boolean",
    },
  ],
});

describe("model slug normalization", () => {
  it("preserves exact custom slugs instead of expanding provider aliases", () => {
    const claude = ProviderDriverKind.make("claudeAgent");

    expect(normalizeModelSlug("opus", claude)).toBe("opus");
    expect(normalizeCustomModelSlug(" opus ")).toBe("opus");
  });
});

const claudeCaps: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "medium", label: "Medium" },
        { id: "high", label: "High", isDefault: true },
        { id: "ultrathink", label: "Ultrathink" },
      ],
      currentValue: "high",
      promptInjectedValues: ["ultrathink"],
    },
    {
      id: "contextWindow",
      label: "Context Window",
      type: "select",
      options: [
        { id: "200k", label: "200k" },
        { id: "1m", label: "1M", isDefault: true },
      ],
      currentValue: "1m",
    },
  ],
});

describe("descriptor helpers", () => {
  it("applies selection values to capability descriptors", () => {
    expect(
      getProviderOptionDescriptors({
        caps: claudeCaps,
        selections: [
          { id: "effort", value: "medium" },
          { id: "contextWindow", value: "200k" },
        ],
      }),
    ).toEqual([
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: [
          { id: "medium", label: "Medium" },
          { id: "high", label: "High", isDefault: true },
          { id: "ultrathink", label: "Ultrathink" },
        ],
        currentValue: "medium",
        promptInjectedValues: ["ultrathink"],
      },
      {
        id: "contextWindow",
        label: "Context Window",
        type: "select",
        options: [
          { id: "200k", label: "200k" },
          { id: "1m", label: "1M", isDefault: true },
        ],
        currentValue: "200k",
      },
    ]);
  });

  it("builds dispatch options only from explicit selections", () => {
    const descriptors = getProviderOptionDescriptors({
      caps: codexCaps,
      selections: [{ id: "fastMode", value: true }],
    });

    expect(buildExplicitProviderOptionSelectionsFromDescriptors(descriptors, undefined)).toBe(
      undefined,
    );
    expect(
      buildExplicitProviderOptionSelectionsFromDescriptors(descriptors, [
        { id: "fastMode", value: true },
      ]),
    ).toEqual([{ id: "fastMode", value: true }]);
  });

  it("compares complete model selections independent of option ordering", () => {
    const left = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
      { id: "reasoningEffort", value: "high" },
      { id: "fastMode", value: true },
    ]);
    const reordered = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
      { id: "fastMode", value: true },
      { id: "reasoningEffort", value: "high" },
    ]);

    expect(modelSelectionsEqual(left, reordered)).toBe(true);
    expect(
      modelSelectionsEqual(left, {
        ...reordered,
        options: [
          { id: "fastMode", value: true },
          { id: "reasoningEffort", value: "medium" },
        ],
      }),
    ).toBe(false);
    expect(modelSelectionsEqual(left, { ...reordered, model: "gpt-5.5" })).toBe(false);
  });
});

describe("applyClaudePromptEffortPrefix", () => {
  it("keeps slash commands intact when ultrathink is selected", () => {
    expect(applyClaudePromptEffortPrefix("/compact", "ultrathink")).toBe("/compact");
    expect(applyClaudePromptEffortPrefix(" /compact keep recent errors ", "ultrathink")).toBe(
      "/compact keep recent errors",
    );
    expect(applyClaudePromptEffortPrefix(" /review src/model.ts ", "ultrathink")).toBe(
      "/review src/model.ts",
    );
    expect(applyClaudePromptEffortPrefix("/security-review", "ultrathink")).toBe(
      "/security-review",
    );
    expect(applyClaudePromptEffortPrefix("/plugin:skill run", "ultrathink")).toBe(
      "/plugin:skill run",
    );
    expect(applyClaudePromptEffortPrefix("/deploy.prod to staging", "ultrathink")).toBe(
      "/deploy.prod to staging",
    );
  });

  it("still adds the ultrathink prefix to ordinary prompts", () => {
    expect(applyClaudePromptEffortPrefix("Investigate this failure", "ultrathink")).toBe(
      "Ultrathink:\nInvestigate this failure",
    );
    expect(applyClaudePromptEffortPrefix("/home/theo/app.ts crashed on load", "ultrathink")).toBe(
      "Ultrathink:\n/home/theo/app.ts crashed on load",
    );
  });
});

describe("readCustomModelEntries", () => {
  const capabilities: ModelCapabilities = {
    optionDescriptors: [
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: [{ id: "high", label: "High", isDefault: true }],
        currentValue: "high",
      },
    ],
  };

  it("resolves bare slugs and entries, trimming and deduplicating on slug", () => {
    expect(
      readCustomModelEntries([
        " bare ",
        { slug: "named", name: " Named ", capabilities },
        "bare",
        { slug: "named", name: "Second" },
        "",
        { name: "no slug" },
        42,
      ]),
    ).toEqual([
      { slug: "bare", name: undefined, capabilities: null },
      { slug: "named", name: "Named", capabilities },
    ]);
  });

  it("drops unparseable capabilities but keeps the entry", () => {
    expect(
      readCustomModelEntries([{ slug: "x", capabilities: { optionDescriptors: "nope" } }]),
    ).toEqual([{ slug: "x", name: undefined, capabilities: null }]);
    expect(readCustomModelEntries("not a list")).toEqual([]);
  });

  it("writes the compact stored shape back", () => {
    expect(toCustomModelSetting({ slug: "x", capabilities: null })).toBe("x");
    expect(
      toCustomModelSetting({ slug: "x", name: "x", capabilities: { optionDescriptors: [] } }),
    ).toEqual({ slug: "x", name: "x" });
    expect(
      toCustomModelSetting({ slug: "x", contextWindowTokens: 272000, capabilities: null }),
    ).toEqual({ slug: "x", contextWindowTokens: 272000 });
    expect(toCustomModelSetting({ slug: "x", name: "X", capabilities })).toEqual({
      slug: "x",
      name: "X",
      capabilities,
    });
  });
});

describe("provider-reported option display", () => {
  const selection = createModelSelection(ProviderInstanceId.make("opencode"), "ling");
  const reported = { ...selection, options: [{ id: "variant", value: "default" }] };
  const descriptor = {
    id: "variant",
    label: "Reasoning",
    type: "select" as const,
    options: [
      { id: "none", label: "None" },
      { id: "thinking", label: "Thinking" },
    ],
  };

  it("shows explicit reports without adding a choice or a dispatch option", () => {
    expect(getProviderOptionCurrentLabel(descriptor, selection, reported)).toBe("Default");
    expect(
      getProviderOptionCurrentLabel(descriptor, selection, {
        ...reported,
        options: [{ id: "variant", value: "thinking" }],
      }),
    ).toBe("Thinking");
    expect(
      getProviderOptionCurrentLabel(
        { ...descriptor, currentValue: "none" },
        { ...selection, options: [{ id: "variant", value: "none" }] },
        reported,
      ),
    ).toBe("None");
    expect(descriptor.options.map((option) => option.id)).toEqual(["none", "thinking"]);
    expect(buildProviderOptionSelectionsFromDescriptors([descriptor])).toBeUndefined();
    expect(getProviderOptionCurrentLabel(descriptor, selection)).toBe("Unknown");
    const effortDescriptor = { ...descriptor, id: "effort", currentValue: "default" };
    expect(getProviderOptionCurrentLabel(effortDescriptor, selection)).toBeUndefined();
    expect(
      getProviderOptionCurrentLabel(effortDescriptor, selection, {
        ...reported,
        model: "other",
        options: [{ id: "effort", value: "default" }],
      }),
    ).toBeUndefined();
    expect(
      getProviderOptionCurrentLabel(effortDescriptor, selection, {
        ...reported,
        options: [{ id: "effort", value: "default" }],
      }),
    ).toBe("Default");
    expect(
      getProviderOptionCurrentLabel({ ...descriptor, currentValue: "thinking" }, selection),
    ).toBe("Unknown");
  });

  it.each([
    { ...selection, model: "other" },
    { ...selection, instanceId: ProviderInstanceId.make("other") },
    { ...selection, options: [{ id: "variant", value: "none" }] },
  ])("ignores reports after changing the model, instance, or option: %j", (selected) => {
    expect(getProviderOptionCurrentLabel(descriptor, selected, reported)).toBe("Unknown");
  });
});

it("merges a display and capability override without changing a native model's id or other capabilities", () => {
  const native = [
    {
      slug: "gateway/model",
      name: "Native name",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "effort",
            label: "Effort",
            type: "select" as const,
            options: [{ id: "low", label: "Low" }],
          },
          { id: "fast", label: "Fast", type: "boolean" as const },
        ],
      },
    },
  ];
  const merged = mergeCustomModels(native, [
    {
      slug: "gateway/model",
      name: "My model",
      capabilities: {
        optionDescriptors: [
          {
            id: "effort",
            label: "Effort",
            type: "select",
            options: [{ id: "high", label: "High" }],
          },
        ],
      },
    },
    "opaque",
  ]);
  expect(merged.map((model) => [model.slug, model.name])).toEqual([
    ["gateway/model", "My model"],
    ["opaque", "opaque"],
  ]);
  expect(merged[0]?.capabilities?.optionDescriptors?.map((d) => d.id)).toEqual(["effort", "fast"]);
  expect(merged[1]?.capabilities).toBeNull();
  expect(mergeCustomModels(native, [])[0]).toEqual(native[0]);
});

it("an explicit name equal to the raw ID overrides a native display name", () => {
  expect(
    mergeCustomModels(
      [{ slug: "native-id", name: "Native label", isCustom: false, capabilities: null }],
      [{ slug: "native-id", name: "native-id" }],
    )[0]?.name,
  ).toBe("native-id");
  expect(
    mergeCustomModels(
      [{ slug: "native-id", name: "Native label", isCustom: false, capabilities: null }],
      ["native-id"],
    )[0]?.name,
  ).toBe("Native label");
});
