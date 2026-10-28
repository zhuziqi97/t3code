import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

export const CodexPredictionConfig = Schema.Struct({
  is_enabled: Schema.Boolean,
  prompt: Schema.NonEmptyString,
  prompt_version: Schema.String,
  prediction_reasoning_effort: Schema.String.pipe(
    Schema.decodeTo(Schema.NullOr(Schema.String), {
      decode: SchemaGetter.transform((value) => value || null),
      encode: SchemaGetter.transform((value) => value ?? ""),
    }),
  ),
  unsupported_models: Schema.optionalKey(Schema.Array(Schema.String)),
  live_sample_rate: Schema.optionalKey(
    Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  ),
  catch_up_sample_rate: Schema.optionalKey(
    Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  ),
});
export type CodexPredictionConfig = typeof CodexPredictionConfig.Type;

export function predictionGate(
  config: CodexPredictionConfig,
  model: string,
  trigger: "live" | "catch_up",
  random: number,
) {
  if (!config.is_enabled) return "disabled" as const;
  if (config.unsupported_models?.includes(model)) return "unsupported" as const;
  const rate = (trigger === "live" ? config.live_sample_rate : config.catch_up_sample_rate) ?? 1;
  return random >= rate ? ("not_selected" as const) : null;
}

// Codex desktop 26.1023.51421's existing JSON wrapper; the prompt comes from its service.
export function formatPredictionPrompt(prompt: string) {
  return `${prompt}\n\nReturn only JSON matching this schema: ${JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: { suggestion: { type: ["string", "null"] } },
    required: ["suggestion"],
    additionalProperties: false,
  })}.`;
}
const Suggestion = Schema.Struct({ suggestion: Schema.NullOr(Schema.String) });
const decodeSuggestion = Schema.decodeUnknownOption(Schema.fromJsonString(Suggestion));
export function parsePrediction(text: string | null): string | null {
  if (text === null) return null;
  const parsed = decodeSuggestion(text);
  return parsed._tag === "Some" ? parsed.value.suggestion?.trim() || null : null;
}
