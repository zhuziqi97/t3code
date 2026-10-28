import type { ProviderDriverError } from "./errors.ts";
import type { ProviderUsageLimitsUpdate, ServerProvider } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";
import type { ProviderMaintenanceCapabilities } from "./maintenance.ts";

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
  readonly streamChanges: Stream.Stream<ServerProvider>;
  /** Merge windows by ID; updates with no usable window leave the snapshot untouched. */
  readonly applyUsageLimits: (
    update: ProviderUsageLimitsUpdate & { readonly checkedAt: string },
  ) => Effect.Effect<void>;
}
