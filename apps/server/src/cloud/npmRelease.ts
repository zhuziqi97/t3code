import {
  ServerNpmReleaseError,
  ServerNpmReleaseInput,
  type ServerNpmRelease,
} from "@t3tools/contracts";
import {
  CLI_RELEASE_BASE_URL_ENV,
  CONVENE_CLI_INSTALL_GUIDANCE,
  cliReleaseChannelOf,
  configuredCliReleaseBaseUrl,
} from "@t3tools/shared/cliRelease";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient } from "effect/http";

import { resolveMirrorVersion } from "../cli/update.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import { managedUpdateMirror, managedUpdateRefusal } from "../policy/managedUpdates.ts";

const decodeInput = Schema.decodeUnknownEffect(ServerNpmReleaseInput);

export class NpmRelease extends Context.Service<
  NpmRelease,
  {
    readonly get: (
      input: ServerNpmReleaseInput,
    ) => Effect.Effect<ServerNpmRelease | null, ServerNpmReleaseError>;
  }
>()("t3/cloud/npmRelease") {}

export const make = Effect.fn("NpmRelease.make")(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const policy = yield* ManagedPolicy.ManagedPolicy;
  const mirror = managedUpdateMirror(policy.document);
  const feedUrl = configuredCliReleaseBaseUrl(
    mirror?.feedUrl ?? (yield* HostProcess.Environment)[CLI_RELEASE_BASE_URL_ENV],
  );
  return NpmRelease.of({
    get: Effect.fn("NpmRelease.get")(function* (input) {
      const { spec } = yield* decodeInput(input).pipe(
        Effect.mapError(
          () => new ServerNpmReleaseError({ reason: "Invalid release version or track." }),
        ),
      );
      const channel =
        spec === "latest" ? "stable" : spec === "nightly" ? "nightly" : cliReleaseChannelOf(spec);
      const refusal = managedUpdateRefusal(policy.document, channel);
      if (refusal !== undefined) return yield* new ServerNpmReleaseError({ reason: refusal });
      if (feedUrl === undefined) {
        return yield* new ServerNpmReleaseError({ reason: CONVENE_CLI_INSTALL_GUIDANCE });
      }
      const version = yield* resolveMirrorVersion(
        { organization: mirror?.organization ?? "Convene", feedUrl },
        channel,
      ).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.mapError(({ reason }) => new ServerNpmReleaseError({ reason })),
      );
      return spec === "latest" || spec === "nightly" || version === spec ? { version } : null;
    }),
  });
});

export const layer = Layer.effect(NpmRelease, make()).pipe(Layer.provide(FetchHttpClient.layer));
