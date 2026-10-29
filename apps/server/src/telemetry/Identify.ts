export type TelemetryOwnerSource = "connect" | "openai" | "claude" | "device";

export interface TelemetryOwner {
  readonly source: TelemetryOwnerSource;
  /** `hashTelemetryId` of the source's raw id. */
  readonly ownerId: string;
}
