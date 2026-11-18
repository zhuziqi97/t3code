import { describe, expect, it } from "vite-plus/test";

import { shouldShowOpenInPicker } from "./OpenInPicker.logic";

describe("shouldShowOpenInPicker", () => {
  it("shows the open action for a project and hides it without a project", () => {
    expect(shouldShowOpenInPicker({ activeProjectName: "Project" })).toBe(true);
    expect(shouldShowOpenInPicker({ activeProjectName: undefined })).toBe(false);
  });
});
