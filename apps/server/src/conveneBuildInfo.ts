import { resolveConveneVersion } from "@t3tools/shared/conveneDesktopIdentity";

import packageJson from "../package.json" with { type: "json" };

declare const __T3CODE_CONVENE_VERSION__: string | undefined;
declare const __CONVENE_BUILD_ID__: string | null;
declare const __CONVENE_SOURCE_COMMIT__: string | null;

// The same generated metadata is bundled into Web and every desktop package.
export const CONVENE_BUILD_INFO = {
  version:
    typeof __T3CODE_CONVENE_VERSION__ === "string"
      ? __T3CODE_CONVENE_VERSION__
      : resolveConveneVersion(packageJson.version),
  buildId: typeof __CONVENE_BUILD_ID__ === "string" ? __CONVENE_BUILD_ID__ : undefined,
  sourceCommit:
    typeof __CONVENE_SOURCE_COMMIT__ === "string" ? __CONVENE_SOURCE_COMMIT__ : undefined,
};
