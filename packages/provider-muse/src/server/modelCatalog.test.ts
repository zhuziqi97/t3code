import { describe, expect, it } from "@effect/vitest";

import { museModelCapabilities, resolveMuseReasoningEffort } from "./modelCatalog.ts";

describe("Muse model catalog", () => {
  it.effect("formats Muse model IDs as names without changing their selection slugs", () =>
    Effect.gen(function* () {
      const models = yield* discoverMuseModels(settings, {}, undefined, async () =>
        host({
          providerId: "meta",
          models: [
            row("muse-wonder-1.0", { isDefault: true }),
            row("muse-wonder-full-1.0"),
            row("muse-spark-1.3"),
            row("muse-spark-1.2"),
            row("muse-wonder-2.0", { displayLabel: "  " }),
            row("muse-spark-1.1", { displayLabel: " muse-spark-1.1 " }),
            row("muse-wonder-preview", { displayLabel: " Muse Research Preview " }),
          ],
        }),
      ).pipe(Effect.scoped);
      expect(models.map(({ slug, name, isDefault }) => [slug, name, isDefault])).toEqual([
        ["muse-wonder-1.0", "Muse Wonder 1.0", true],
        ["muse-wonder-full-1.0", "Muse Wonder Full 1.0", false],
        ["muse-spark-1.3", "Muse Spark 1.3", false],
        ["muse-spark-1.2", "Muse Spark 1.2", false],
        ["muse-wonder-2.0", "Muse Wonder 2.0", false],
        ["muse-spark-1.1", "Muse Spark 1.1", false],
        ["muse-wonder-preview", "Muse Research Preview", false],
      ]);
    }),
  );

  it.effect("uses the labels, efforts and defaults that model/list sends", () =>
    Effect.gen(function* () {
      const models = yield* discoverMuseModels(settings, {}, undefined, async () =>
        host({
          providerId: "meta",
          profileId: "tbh",
          source: "providerCatalog",
          models: [
            row("restful-walrus", {
              displayLabel: " Restful Walrus ",
              isDefault: true,
              variants: ["minimal", "low", "high", "future-tier"],
              reasoningEffortVariants: [{ tier: "low", description: "Quick" }],
              defaultReasoningEffort: "high",
            }),
            row("older-host"),
            row("unknown-efforts", { variants: "unknown" }),
            row("foreign", { providerId: "another" }),
          ],
        }),
      ).pipe(Effect.scoped);
      expect(models.map(({ slug, name, isDefault }) => [slug, name, isDefault])).toEqual([
        ["restful-walrus", "Restful Walrus", true],
        ["older-host", "older-host", false],
        ["unknown-efforts", "unknown-efforts", false],
      ]);
      expect(models[0]?.capabilities?.optionDescriptors).toEqual([
        {
          id: "reasoningEffort",
          label: "Reasoning",
          type: "select",
          currentValue: "high",
          options: [
            { id: "minimal", label: "Minimal" },
            { id: "low", label: "Low", description: "Quick" },
            { id: "high", label: "High", isDefault: true },
          ],
        },
      ]);
      expect(models[1]?.capabilities).toEqual(museModelCapabilities());
      expect(models[2]?.capabilities).toEqual(museModelCapabilities());
    }),
  );

  it("preserves explicit efforts and leaves implicit effort to Muse", () => {
    const fallback = museModelCapabilities();
    expect(resolveMuseReasoningEffort(fallback, undefined)).toBeUndefined();
    expect(resolveMuseReasoningEffort(fallback, "max")).toBe("max");
    expect(resolveMuseReasoningEffort(fallback, "ultra")).toBe("ultra");
    const restricted = museModelCapabilities({ variants: ["xhigh"] });
    expect(resolveMuseReasoningEffort(restricted, undefined)).toBeUndefined();
    expect(resolveMuseReasoningEffort(restricted, "low")).toBe("low");
    expect(resolveMuseReasoningEffort(museModelCapabilities({ variants: [] }), "max")).toBe("max");
    expect(resolveMuseReasoningEffort(undefined, "max")).toBe("max");
  });
});
