import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createWorkspaceRecoveryAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    inspect: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:thread:workspace",
      tag: WS_METHODS.threadWorkspaceInspect,
    }),
    recover: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread:recover-workspace",
      tag: WS_METHODS.threadWorkspaceRecover,
    }),
  };
}
