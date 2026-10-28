import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as GlobalFlag from "effect/cli/GlobalFlag";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";

import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ConvenePlatform from "../convene/ConvenePlatform.ts";
import { authLocationFlags, resolveCliAuthConfig, type CliAuthLocationFlags } from "./config.ts";

const withPlatform = Effect.fn("convene.withPlatform")(function* <A, E>(
  flags: CliAuthLocationFlags,
  operation: (platform: ConvenePlatform.ConvenePlatform["Service"]) => Effect.Effect<A, E>,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  return yield* Effect.flatMap(ConvenePlatform.ConvenePlatform, operation).pipe(
    Effect.provide(
      ConvenePlatform.layer.pipe(
        Layer.provide(ServerSecretStore.layer),
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
  );
});

const pair = Command.make("pair", { ...authLocationFlags, url: Flag.String("url") }).pipe(
  Command.withDescription(
    "Start Convene pairing. Approve the displayed code in the platform, then run exchange.",
  ),
  Command.withHandler((flags) =>
    withPlatform(flags, (platform) =>
      platform
        .beginPairing(flags.url)
        .pipe(Effect.flatMap((pairing) => Console.log(JSON.stringify(pairing)))),
    ),
  ),
);
const exchange = Command.make("exchange", {
  ...authLocationFlags,
  url: Flag.String("url"),
  deviceCode: Flag.String("device-code"),
}).pipe(
  Command.withDescription(
    "Finish an approved pairing and save its device credential. Restart this T3 server to connect.",
  ),
  Command.withHandler((flags) =>
    withPlatform(flags, (platform) =>
      platform
        .finishPairing(flags.url, flags.deviceCode)
        .pipe(
          Effect.flatMap((connection) =>
            Console.log(
              `Convene paired: ${connection.runnerId}. Restart this T3 server to connect.`,
            ),
          ),
        ),
    ),
  ),
);
const disconnect = Command.make("disconnect", { ...authLocationFlags }).pipe(
  Command.withDescription(
    "Remove the local Convene credential. Restart this T3 server to close its connection.",
  ),
  Command.withHandler((flags) => withPlatform(flags, (platform) => platform.disconnect)),
);
export const conveneCommand = Command.make("convene").pipe(
  Command.withDescription("Connect this T3 environment to Convene."),
  Command.withSubcommands([pair, exchange, disconnect]),
);
