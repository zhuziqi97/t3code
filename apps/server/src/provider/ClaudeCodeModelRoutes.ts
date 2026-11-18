import {
  resolveSettings as resolveClaudeSettings,
  type SettingSource,
  type Settings as ClaudeSdkSettings,
} from "@anthropic-ai/claude-agent-sdk";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { claudeLocalSettingsDirectory } from "./Drivers/ClaudeHome.ts";

// Env names that pick the backend, its region, or the model a family alias resolves to.
const MODEL_SETTINGS_ENV_PREFIXES = [
  "ANTHROPIC_",
  "CLAUDE_CODE_USE_",
  "AWS_",
  "CLOUD_ML_",
  "VERTEX_",
];

/** Equal keys mean Claude Code resolves model ids the same way under both settings. */
function claudeModelSettingsKey(settings: ClaudeSdkSettings): string {
  const sortedEntries = (record: Readonly<Record<string, string | undefined>> | undefined) =>
    Object.entries(record ?? {}).toSorted(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([
    settings.availableModels ?? null,
    sortedEntries(settings.modelOverrides),
    sortedEntries(settings.env).filter(([name]) =>
      MODEL_SETTINGS_ENV_PREFIXES.some((prefix) => name.startsWith(prefix)),
    ),
  ]);
}

const NO_MODEL_SETTINGS_KEY = claudeModelSettingsKey({});

class ClaudeModelSettingsReadError extends Schema.TaggedError<ClaudeModelSettingsReadError>()(
  "ClaudeModelSettingsReadError",
  { cause: Schema.Defect() },
) {}

export const resolveClaudeModelSettingsKey = Effect.fn("resolveClaudeModelSettingsKey")(function* (
  settingSources: ReadonlyArray<SettingSource>,
  cwd: string | null,
) {
  // The SDK reads the local file from cwd, Claude Code from the main checkout's root. No key, so
  // no routes, when that root file touches model settings.
  const localDirectory = cwd === null ? null : yield* claudeLocalSettingsDirectory(cwd);
  if (localDirectory !== null && localDirectory !== cwd) {
    const rootLocal = yield* Effect.tryPromise({
      try: () => resolveClaudeSettings({ cwd: localDirectory, settingSources: ["local"] }),
      catch: (cause) => new ClaudeModelSettingsReadError({ cause }),
    }).pipe(
      Effect.map(({ sources }) => sources.find(({ source }) => source === "local")?.settings),
      Effect.orElseSucceed(() => null),
    );
    if (rootLocal === null || claudeModelSettingsKey(rootLocal ?? {}) !== NO_MODEL_SETTINGS_KEY)
      return undefined;
  }
  return yield* Effect.tryPromise({
    try: () =>
      resolveClaudeSettings({
        ...(cwd === null ? {} : { cwd }),
        settingSources: [...settingSources],
      }),
    catch: (cause) => new ClaudeModelSettingsReadError({ cause }),
  }).pipe(
    Effect.map(({ effective }) => claudeModelSettingsKey(effective)),
    Effect.orElseSucceed(() => undefined),
  );
});
