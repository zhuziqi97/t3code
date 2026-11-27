import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import { executeAtomQuery, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { CONVENE_CLI_INSTALL_GUIDANCE, cliReleaseChannelOf } from "@t3tools/shared/cliRelease";
import { compareSemverVersions } from "@t3tools/shared/semver";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";
import { msg } from "gt-react-native";

import { m } from "../../i18n/messages";
import { appAtomRegistry } from "../../state/atom-registry";
import { serverEnvironment } from "../../state/server";

export interface EnvironmentReleaseCheck {
  readonly fromVersion: string;
  readonly targetVersion: string | null;
}

export class EnvironmentUpdateCheckError extends Schema.TaggedError<EnvironmentUpdateCheckError>()(
  "EnvironmentUpdateCheckError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

const asError = (cause: unknown) =>
  new EnvironmentUpdateCheckError({
    message:
      cause instanceof Error
        ? (errorDisplayMessage(cause, m) ?? cause.message)
        : m(msg("Could not check for updates.")),
    cause,
  });

export const environmentReleaseCheckAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.fn((fromVersion: string) =>
    Effect.tryPromise({
      try: async (signal) => {
        const capabilities = appAtomRegistry.get(
          serverEnvironment.configValueAtom(environmentId),
        )?.environment.capabilities;
        if (capabilities?.cliArchiveReleaseLookup !== true) {
          throw new Error(CONVENE_CLI_INSTALL_GUIDANCE);
        }
        const spec = cliReleaseChannelOf(fromVersion) === "nightly" ? "nightly" : "latest";
        const release = await executeAtomQuery(
          appAtomRegistry,
          serverEnvironment.npmRelease({ environmentId, input: { spec } }),
          { reportDefect: false, reportFailure: false, signal },
        );
        if (release._tag === "Failure") throw squashAtomCommandFailure(release);
        const version = release.value?.version;
        return {
          fromVersion,
          targetVersion: version && compareSemverVersions(version, fromVersion) > 0 ? version : null,
        } satisfies EnvironmentReleaseCheck;
      },
      catch: asError,
    }),
  ).pipe(Atom.withLabel(`mobile:environment-release-check:${environmentId}`)),
);

export function releaseCheckValue(
  result: AsyncResult.AsyncResult<EnvironmentReleaseCheck, Error>,
): EnvironmentReleaseCheck | null {
  return AsyncResult.getOrElse(result, () => null);
}
