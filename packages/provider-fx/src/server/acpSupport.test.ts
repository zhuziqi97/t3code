import { assert, describe, it } from "@effect/vitest";
import type * as EffectAcpSchema from "effect-acp/compat";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";

import { ProviderAdapterV2RuntimePolicy } from "@t3tools/provider-core/server/ProviderAdapter";

import { applyFxModelSelection, fxPermissionDisposition } from "./acpSupport.ts";

it.effect("keeps the native fx model when the selection follows the provider default", () =>
  Effect.gen(function* () {
    const runtime = yield* AcpSessionRuntime.AcpSessionRuntime;
    const model = yield* applyFxModelSelection(
      runtime,
      { instanceId: ProviderInstanceId.make("fx-default"), model: null },
      undefined,
    );
    assert.equal(model, "native/model");
  }).pipe(
    Effect.provide(
      Layer.mock(AcpSessionRuntime.AcpSessionRuntime)({
        getConfigOptions: Effect.succeed([
          {
            id: "model",
            name: "Model",
            type: "select",
            currentValue: "native/model",
            options: [{ value: "native/model", name: "Native model" }],
          },
        ]),
        setConfigOption: () =>
          Effect.die("Following the native model must not select another model"),
      }),
    ),
  ),
);

const editRequest = {
  sessionId: "fx-session-01",
  toolCall: { toolCallId: "tool-1", kind: "edit", title: "Write notes.md" },
  options: [
    { optionId: "allow", name: "Allow", kind: "allow_once" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ],
} satisfies EffectAcpSchema.RequestPermissionRequest;

describe("fx permission prompts", () => {
  // In Auto, fx's own review asks only about what it refused itself; T3
  // answering those by its Auto policy would approve exactly what fx escalated.
  it("sends every Auto prompt to the user", () => {
    assert.equal(
      fxPermissionDisposition(
        ProviderAdapterV2RuntimePolicy.make({
          runtimeMode: "auto",
          interactionMode: "default",
          cwd: "/work",
        }),
        editRequest,
      ),
      "ask",
    );
  });
});
