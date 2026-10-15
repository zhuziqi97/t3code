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

/** Default fork release for the checked-out upstream base. Explicit artifact versions override it. */
export function resolveConveneVersion(upstreamVersion: string): string {
  return `${upstreamVersion}${upstreamVersion.includes("-") ? "." : "-"}convene.13`;
}
