import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import {
  CodexPredictionConfig,
  formatPredictionPrompt,
  parsePrediction,
  predictionGate,
} from "./CodexPredictionPolicy.ts";

const decodeConfig = Schema.decodeSync(CodexPredictionConfig);
const fixture = {
  is_enabled: true,
  prompt: "official fixture prompt",
  prompt_version: "fixture",
  prediction_reasoning_effort: "high",
  live_sample_rate: 1,
  catch_up_sample_rate: 1,
};
it("normalizes the official empty reasoning effort to null", () => {
  const config = decodeConfig({
    ...fixture,
    prediction_reasoning_effort: "",
  });
  assert.isNull(config.prediction_reasoning_effort);
});
it("respects disabled, model exclusion, live and catch-up zero rates", () => {
  const config = decodeConfig(fixture);
  assert.equal(
    predictionGate({ ...config, is_enabled: false }, "native-model", "live", 0),
    "disabled",
  );
  assert.equal(
    predictionGate({ ...config, unsupported_models: ["native-model"] }, "native-model", "live", 0),
    "unsupported",
  );
  assert.equal(
    predictionGate({ ...config, live_sample_rate: 0 }, "native-model", "live", 0),
    "not_selected",
  );
  assert.equal(
    predictionGate({ ...config, catch_up_sample_rate: 0 }, "native-model", "catch_up", 0),
    "not_selected",
  );
  assert.isNull(predictionGate(config, "native-model", "live", 0.8));
});
it("uses the exact desktop JSON wrapper around the unmodified service prompt", () => {
  assert.equal(
    formatPredictionPrompt("official fixture prompt"),
    'official fixture prompt\n\nReturn only JSON matching this schema: {"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"suggestion":{"type":["string","null"]}},"required":["suggestion"],"additionalProperties":false}.',
  );
  assert.equal(parsePrediction('{"suggestion":"  Edit this draft  "}'), "Edit this draft");
  for (const text of [null, "", "invalid", '{"suggestion":null}', '{"suggestion":42}'])
    assert.isNull(parsePrediction(text));
});
