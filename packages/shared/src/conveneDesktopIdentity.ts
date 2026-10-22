/** The fork's installed identity is separate from upstream and its development builds. */
export const CONVENE_DESKTOP_IDENTITY = {
  name: "T3 Code for Convene",
  appId: "tech.ziqi.t3code-convene",
  executableName: "t3code-convene",
  homeDirectoryName: ".convene-code",
  electronUserDataName: "t3code-convene-v2",
  developmentUserDataName: "t3code-convene-dev",
  scheme: "t3code-convene",
  developmentScheme: "t3code-convene-dev",
} as const;

// Release packaging rewrites package versions; this records the fixed upstream input.
export const CONVENE_UPSTREAM_VERSION = "0.1.1";

/** Default fork release for the checked-out upstream base. Explicit artifact versions override it. */
export function resolveConveneVersion(upstreamVersion: string): string {
  if (upstreamVersion.includes("-")) return upstreamVersion;
  return `${upstreamVersion}-1`;
}
