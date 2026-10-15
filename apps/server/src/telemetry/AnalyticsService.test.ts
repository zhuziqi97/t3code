import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as TestClock from "effect/testing/TestClock";
import * as AnalyticsService from "./AnalyticsService.ts";

it.effect("never sends analytics even when upstream environment variables enable it", () => {
  let requests = 0;
  const client = HttpClient.make(() => {
    requests += 1;
    return Effect.die("Product analytics must not contact an upstream service");
  });
  return Effect.gen(function* () {
    const analytics = yield* AnalyticsService.AnalyticsService;
    yield* analytics.record("client.connected", { surface: "desktop" });
    yield* analytics.record("provider.turn.completed", { model: "custom-model", inputTokens: 10 });
    yield* TestClock.adjust("1 minute");
    yield* analytics.flush;
    assert.equal(requests, 0);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        AnalyticsService.layer,
        Layer.succeed(HttpClient.HttpClient, client),
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            T3CODE_TELEMETRY_ENABLED: "true",
            T3CODE_POSTHOG_HOST: "http://127.0.0.1:1",
            T3CODE_POSTHOG_KEY: "test-key",
          }),
        ),
      ),
    ),
  );
});
