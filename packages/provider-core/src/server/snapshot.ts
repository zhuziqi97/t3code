import type { ProviderDriverError } from "./errors.ts";
import type {
  ProviderUsageLimitsUpdate,
  ServerProvider,
  ServerSettingsError,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";
import type { ProviderMaintenanceCapabilities } from "./maintenance.ts";

/** authLabel names the plan, for drivers whose usage report carries it. */
export type ProviderUsageLimitsReport = ProviderUsageLimitsUpdate & {
  readonly checkedAt: string;
  readonly authLabel?: string;
  /** A full reading replaces sparse windows and clears a previous probe failure. */
  readonly complete?: boolean;
};

export interface ManagedServerProvider {
  /** Cached; pass { fresh: true } before executing updates. */
  readonly resolveMaintenance: (options?: {
    readonly fresh?: boolean;
  }) => Effect.Effect<ProviderMaintenanceCapabilities>;
  readonly getSnapshot: Effect.Effect<ServerProvider>;
  readonly refresh: Effect.Effect<ServerProvider>;
  /** Start or join an instance-owned refresh without awaiting discovery. */
  readonly startRefresh: (options?: {
    readonly cwd?: string;
    readonly kind?: "workspace" | "models";
    readonly work?: (
      check: Effect.Effect<ServerProvider>,
    ) => Effect.Effect<unknown, ProviderDriverError>;
  }) => Effect.Effect<ServerProvider>;
  readonly cancelRefresh: (operationId: string) => Effect.Effect<void>;
  readonly refreshUsage?: Effect.Effect<void, ServerSettingsError>;
  readonly streamChanges: Stream.Stream<ServerProvider>;
  /** Merge windows by ID and set any authLabel; an update with no window leaves the snapshot untouched. */
  readonly applyUsageLimits: (update: ProviderUsageLimitsReport) => Effect.Effect<void>;
}
