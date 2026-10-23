import type { ProviderDriverKind, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";
import type { ManagedServerProvider } from "@t3tools/provider-core/server/snapshot";

export type ProviderSnapshotSource = {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly supportsMcpTools: Effect.Effect<boolean | undefined>;
  readonly getSnapshot: ManagedServerProvider["getSnapshot"];
  readonly refresh: ManagedServerProvider["refresh"];
  readonly startRefresh: ManagedServerProvider["startRefresh"];
  readonly cancelRefresh: ManagedServerProvider["cancelRefresh"];
  readonly streamChanges: Stream.Stream<ServerProvider>;
};
