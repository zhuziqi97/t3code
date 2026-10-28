import type {
  AcpRegistryPrepareResult,
  AcpRegistryPrepareInput,
  EnvironmentId,
  ProviderInstanceConfig,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { squashAtomCommandFailure, type AtomCommandResult } from "./state/runtime.ts";

export function managedAcpRegistryUpdateTarget(instance: ProviderInstanceConfig | undefined) {
  if (
    instance?.driver !== "acpRegistry" ||
    instance.config === null ||
    typeof instance.config !== "object"
  )
    return null;
  const config = instance.config as Record<string, unknown>;
  if (
    config.source === "local" ||
    (typeof config.commandPath === "string" && config.commandPath.trim())
  )
    return null;
  const agentId = typeof config.agentId === "string" ? config.agentId.trim() : "";
  if (!agentId) return null;
  const distribution = config.distribution;
  return {
    agentId,
    ...(distribution === "binary" || distribution === "npx" || distribution === "uvx"
      ? { distribution }
      : {}),
  } satisfies AcpRegistryPrepareInput;
}

export type AcpRegistryUpdateState =
  | { readonly phase: "idle" | "preparing" | "refreshing" | "succeeded" }
  | {
      readonly phase: "failed";
      readonly stage: "prepare" | "refresh";
      readonly error: string | null;
    };

export async function runAcpRegistryUpdate(
  target: {
    readonly environmentId: EnvironmentId;
    readonly instanceId: ProviderInstanceId;
    readonly agentId: string;
    readonly distribution?: AcpRegistryPrepareInput["distribution"];
  },
  previous: AcpRegistryUpdateState,
  commands: {
    readonly prepare: (target: {
      environmentId: EnvironmentId;
      input: AcpRegistryPrepareInput;
    }) => Promise<AtomCommandResult<AcpRegistryPrepareResult, unknown>>;
    readonly refresh: (target: {
      environmentId: EnvironmentId;
      input: { instanceId: ProviderInstanceId };
    }) => Promise<AtomCommandResult<unknown, unknown>>;
  },
  publish: (state: AcpRegistryUpdateState) => void,
): Promise<void> {
  const fail = (stage: "prepare" | "refresh", result: AtomCommandResult<unknown, unknown>) => {
    if (result._tag === "Success") return false;
    const error = squashAtomCommandFailure(result);
    publish({ phase: "failed", stage, error: error instanceof Error ? error.message : null });
    return true;
  };
  if (previous.phase !== "failed" || previous.stage !== "refresh") {
    publish({ phase: "preparing" });
    const prepared = await commands.prepare({
      environmentId: target.environmentId,
      input: {
        agentId: target.agentId,
        ...(target.distribution === undefined ? {} : { distribution: target.distribution }),
      },
    });
    if (prepared._tag === "Failure") {
      fail("prepare", prepared);
      return;
    }
    if (target.distribution !== undefined && prepared.value.distribution !== target.distribution) {
      publish({
        phase: "failed",
        stage: "prepare",
        error: `The environment prepared ${prepared.value.distribution} instead of ${target.distribution}. Update the server before retrying.`,
      });
      return;
    }
  }
  publish({ phase: "refreshing" });
  const refreshed = await commands.refresh({
    environmentId: target.environmentId,
    input: { instanceId: target.instanceId },
  });
  if (!fail("refresh", refreshed)) publish({ phase: "succeeded" });
}
