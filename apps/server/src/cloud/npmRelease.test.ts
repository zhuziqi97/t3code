import { expect, it } from "@effect/vitest";
import { type ManagedPolicyDocument } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as NpmRelease from "./npmRelease.ts";

const environment = (feedUrl?: string) =>
  Effect.provideService(
    HostProcess.Environment,
    feedUrl ? { T3CODE_RELEASE_BASE_URL: feedUrl } : {},
  );

it.effect.each([undefined, "https://github.com/pingdotgg/t3code/releases/download"])(
  "gives installation guidance without a Convene source (%s)",
  (feedUrl) =>
    Effect.gen(function* () {
      const release = yield* NpmRelease.make();
      const error = yield* release.get({ spec: "latest" }).pipe(Effect.flip);
      expect(error.reason).toContain("configure a CLI archive mirror");
    }).pipe(
      environment(feedUrl),
      Effect.provide(ManagedPolicy.layerTest()),
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die("unexpected request")),
      ),
    ),
);

it.effect("looks up the connected host's configured mirror and preserves its query", () =>
  Effect.gen(function* () {
    const urls: string[] = [];
    const release = yield* NpmRelease.make().pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          urls.push(request.url);
          return Effect.succeed(
            HttpClientResponse.fromWeb(request, new Response("version: 0.1.13-1\n")),
          );
        }),
      ),
    );
    expect(yield* release.get({ spec: "latest" })).toEqual({ version: "0.1.13-1" });
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0]!);
    expect(url.origin).toBe("https://cli.example.test");
    expect(url.pathname).toMatch(/^\/archives\/latest(?:-[\w-]+)?\.yml$/);
    expect(url.searchParams.get("token")).toBe("fixture");
  }).pipe(
    environment("https://cli.example.test/archives?token=fixture"),
    Effect.provide(ManagedPolicy.layerTest()),
  ),
);

it.effect("honors the managed update prohibition before reaching the mirror", () => {
  const policy: ManagedPolicyDocument = {
    schemaVersion: 1,
    organization: "Example",
    limits: { updates: { mode: "off" } },
  };
  return Effect.gen(function* () {
    const release = yield* NpmRelease.make();
    const error = yield* release.get({ spec: "latest" }).pipe(Effect.flip);
    expect(error.reason).toContain("Example manages");
  }).pipe(
    environment("https://cli.example.test"),
    Effect.provide(ManagedPolicy.layerTest(policy)),
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die("unexpected request")),
    ),
  );
});
