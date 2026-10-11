import { assert, it } from "@effect/vitest";

import { applyNativeCodexDefaultModel, mapCodexModelCapabilities } from "./CodexProvider.ts";

it("maps current Codex model capability fields", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: [],
    defaultReasoningEffort: "super-high",
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    defaultServiceTier: "flex",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "Lower latency responses.",
      },
      {
        id: "flex",
        name: "Flex",
        description: "Lower-cost asynchronous routing.",
      },
    ],
    supportedReasoningEfforts: [
      {
        description: "Maximum reasoning",
        reasoningEffort: "super-high",
      },
    ],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "super-high", label: "super-high", isDefault: true }],
      currentValue: "super-high",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard" },
        {
          id: "priority",
          label: "Fast",
          description: "Lower latency responses.",
        },
        {
          id: "flex",
          label: "Flex",
          description: "Lower-cost asynchronous routing.",
          isDefault: true,
        },
      ],
      currentValue: "flex",
    },
  ]);
});

it("uses standard routing when the catalog has no default service tier", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: ["fast"],
    defaultReasoningEffort: "medium",
    defaultServiceTier: null,
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "1.5x speed, increased usage",
      },
      {
        id: "ultrafast",
        name: "Ultrafast",
        description: "The fastest available responses for latency-sensitive work.",
      },
    ],
    supportedReasoningEfforts: [],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        {
          id: "priority",
          label: "Fast",
          description: "1.5x speed, increased usage",
        },
        {
          id: "ultrafast",
          label: "Ultrafast",
          description: "Even faster, more expensive",
        },
      ],
      currentValue: "default",
    },
  ]);
});

it("uses configured native model over the catalog recommendation", () => {
  const models = applyNativeCodexDefaultModel(
    [
      { slug: "catalog", name: "Catalog", isCustom: false, isDefault: true, capabilities: null },
      { slug: "configured", name: "Configured", isCustom: false, capabilities: null },
    ],
    "configured",
  );
  assert.deepStrictEqual(
    models.filter((m) => m.isDefault).map((m) => m.slug),
    ["configured"],
  );
});
it("preserves a configured model absent from discovery", () => {
  const models = applyNativeCodexDefaultModel([], "provider/model-x");
  assert.equal(models[0]?.slug, "provider/model-x");
  assert.equal(models[0]?.isDefault, true);
});
it("uses a native catalog default only when configuration is unset", () => {
  const models = applyNativeCodexDefaultModel([
    { slug: "native", name: "Native", isDefault: true, isCustom: false, capabilities: null },
  ]);
  assert.equal(models.find((m) => m.isDefault)?.slug, "native");
  assert.equal(
    applyNativeCodexDefaultModel([
      { slug: "first", name: "First", isCustom: false, capabilities: null },
    ]).some((m) => m.isDefault),
    false,
  );
});
