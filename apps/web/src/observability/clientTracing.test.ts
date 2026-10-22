import { expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as ClientTracer from "./clientTracer";
import { configureClientTracing, type ClientTracingConfig } from "./clientTracing";

it.live(
  "keeps default and Convene-mounted activity free of exporters, preserving explicit direct export",
  () =>
    Effect.gen(function* () {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
      const browser = {
        location: { origin: "http://127.0.0.1:39999", href: "http://127.0.0.1:39999/" },
        __T3_BASE_PATH__: "",
      };
      vi.stubGlobal("window", browser);
      vi.stubGlobal("fetch", fetch);
      vi.useFakeTimers();
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await configureClientTracing();
          vi.useRealTimers();
          vi.unstubAllGlobals();
        }),
      );
      const activity = Effect.void.pipe(
        Effect.withSpan("client.navigation"),
        Effect.provide(ClientTracer.layer),
      );
      const configure = (config?: ClientTracingConfig) =>
        Effect.promise(() => configureClientTracing(config));
      const advance = (millis: number) => Effect.promise(() => vi.advanceTimersByTimeAsync(millis));

      yield* configure();
      for (let index = 0; index < 60; index++) {
        yield* activity;
        yield* advance(1_000);
      }
      expect(ClientTracer.hasDelegate()).toBe(false);
      expect(fetch).not.toHaveBeenCalled();

      browser.__T3_BASE_PATH__ = "/deploy/client-web/session";
      yield* configure({ otlpTracesEnabled: true });
      yield* activity;
      yield* advance(60_000);
      expect(ClientTracer.hasDelegate()).toBe(false);
      expect(fetch).not.toHaveBeenCalled();

      browser.__T3_BASE_PATH__ = "";
      yield* configure({ otlpTracesEnabled: true });
      expect(ClientTracer.hasDelegate()).toBe(true);
      yield* activity;
      yield* advance(1_000);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(String(fetch.mock.calls[0]?.[0])).toBe(
        "http://127.0.0.1:39999/api/observability/v1/traces",
      );
      // A compatibility 204 neither retries the batch nor creates tracing spans of its own.
      yield* advance(60_000);
      expect(fetch).toHaveBeenCalledTimes(1);

      yield* configure({ otlpTracesEnabled: true });
      yield* configure();
      expect(ClientTracer.hasDelegate()).toBe(false);
      yield* activity;
      yield* advance(60_000);
      expect(fetch).toHaveBeenCalledTimes(1);
    }).pipe(Effect.scoped),
);
