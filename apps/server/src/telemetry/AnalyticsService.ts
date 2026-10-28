import type { TelemetryOwner } from "./Identify.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** Preserve upstream call sites without collecting or sending product usage data. */
export class AnalyticsService extends Context.Service<
  AnalyticsService,
  {
    readonly record: (
      event: string,
      properties?: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<void>;
    readonly flush: Effect.Effect<void>;
    readonly recordOwners: (
      owners: ReadonlyArray<TelemetryOwner>,
      source: "client" | "server",
    ) => Effect.Effect<void>;
  }
>()("t3/telemetry/AnalyticsService") {
  static readonly layerTest = Layer.succeed(
    AnalyticsService,
    AnalyticsService.of({
      record: Effect.fn("AnalyticsService.record")(function () {
        return Effect.void;
      }),
      flush: Effect.void,
      recordOwners: Effect.fn("AnalyticsService.recordOwners")(function () {
        return Effect.void;
      }),
    }),
  );
}

// Convene distributions never enable upstream product analytics, including via env overrides.
export const layer = AnalyticsService.layerTest;
