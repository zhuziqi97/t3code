import {
  ConveneIntegrationError,
  ConveneManageInput,
  ConveneManageResult,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ConvenePlatform from "./ConvenePlatform.ts";
import * as ConveneConnection from "./ConveneConnection.ts";
import * as ConveneConfiguration from "./ConveneConfiguration.ts";
const isIntegrationError = Schema.is(ConveneIntegrationError);

export class ConveneSettings extends Context.Service<
  ConveneSettings,
  {
    readonly manage: (
      input: typeof ConveneManageInput.Type,
    ) => Effect.Effect<typeof ConveneManageResult.Type, ConveneIntegrationError>;
    readonly queryProject: (
      projectId: ProjectId,
    ) => ReturnType<ConveneConfiguration.ConveneConfiguration["Service"]["query"]>;
  }
>()("t3/convene/ConveneSettings") {}

const make = Effect.gen(function* () {
  const platform = yield* ConvenePlatform.ConvenePlatform;
  const connection = yield* ConveneConnection.ConveneConnection;
  const configurations = yield* ConveneConfiguration.ConveneConfiguration;
  const manage = Effect.fn("ConveneSettings.manage")(function* (
    input: typeof ConveneManageInput.Type,
  ) {
    if (input.operation === "pair" || input.operation === "exchange") {
      const parsed = yield* Effect.try({
        try: () => new URL(input.baseUrl.trim()),
        catch: (cause) =>
          new ConveneIntegrationError({
            operation: input.operation,
            code: "INVALID_PLATFORM_URL",
            cause,
          }),
      });
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        return yield* new ConveneIntegrationError({
          operation: input.operation,
          code: "INVALID_PLATFORM_URL",
        });
      const baseUrl = parsed.toString().replace(/\/$/, "");
      if (input.operation === "pair")
        return { type: "pairing" as const, pairing: yield* platform.beginPairing(baseUrl) };
      yield* platform.finishPairing(baseUrl, input.deviceCode);
    } else if (input.operation === "disconnect") {
      yield* platform.disconnect;
    } else {
      yield* platform.reconnect;
    }
    return { type: "status" as const, status: yield* connection.status };
  });
  return ConveneSettings.of({
    manage: (input) =>
      manage(input).pipe(
        Effect.mapError((cause) =>
          isIntegrationError(cause)
            ? cause
            : new ConveneIntegrationError({
                operation: "connection",
                code: cause.code ?? "PLATFORM_UNAVAILABLE",
                cause,
              }),
        ),
      ),
    queryProject: (projectId) =>
      Effect.gen(function* () {
        if ((yield* connection.status).phase === "online") yield* connection.synchronize;
        return yield* configurations.query(projectId);
      }),
  });
});

export const layer = Layer.effect(ConveneSettings, make);
