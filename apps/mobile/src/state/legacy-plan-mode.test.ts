import { describe, expect, it } from "@effect/vitest";

import {
  resolveLegacyPlanModeEnabled,
  resolvePendingTaskInteractionMode,
  resolveProviderInteractionMode,
} from "./legacy-plan-mode";

describe("resolveProviderInteractionMode", () => {
  it("clears saved plan mode when the provider cannot use T3 interaction modes", () => {
    expect(resolveProviderInteractionMode({ showInteractionModeToggle: false }, "plan")).toBe(
      "default",
    );
  });

  it("keeps supported choices and remains compatible with older server status", () => {
    expect(resolveProviderInteractionMode({ showInteractionModeToggle: true }, "plan")).toBe(
      "plan",
    );
    expect(resolveProviderInteractionMode({}, "plan")).toBe("plan");
    expect(resolveProviderInteractionMode(null, "plan")).toBe("plan");
    expect(resolveProviderInteractionMode(undefined, undefined)).toBe("default");
  });
});

describe("resolvePendingTaskInteractionMode", () => {
  it("uses build mode when disabled or unsupported", () => {
    expect(
      resolvePendingTaskInteractionMode({ planModeEnabled: false, draftInteractionMode: "plan" }),
    ).toBe("default");
    expect(
      resolvePendingTaskInteractionMode({
        planModeEnabled: true,
        draftInteractionMode: "plan",
        provider: { showInteractionModeToggle: false },
      }),
    ).toBe("default");
  });
  it("preserves a supported draft choice when enabled", () => {
    expect(
      resolvePendingTaskInteractionMode({ planModeEnabled: true, draftInteractionMode: "plan" }),
    ).toBe("plan");
    expect(
      resolvePendingTaskInteractionMode({ planModeEnabled: true, draftInteractionMode: undefined }),
    ).toBe("default");
  });
});

describe("resolveLegacyPlanModeEnabled", () => {
  it("defaults on after preferences load, retaining explicit old values", () => {
    expect(resolveLegacyPlanModeEnabled({ loaded: false, preference: undefined })).toBe(false);
    expect(resolveLegacyPlanModeEnabled({ loaded: true, preference: undefined })).toBe(true);
    expect(resolveLegacyPlanModeEnabled({ loaded: true, preference: false })).toBe(false);
    expect(resolveLegacyPlanModeEnabled({ loaded: true, preference: true })).toBe(true);
  });
});
