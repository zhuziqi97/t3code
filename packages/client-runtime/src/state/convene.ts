import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createConveneEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    status: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:convene:status",
      tag: WS_METHODS.conveneSubscribeStatus,
    }),
    manage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:convene:manage",
      tag: WS_METHODS.conveneManage,
    }),
    queryProject: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:convene:query-project",
      tag: WS_METHODS.conveneQueryProject,
    }),
    mutateProject: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:convene:mutate-project",
      tag: WS_METHODS.conveneMutateProject,
    }),
    projectOptions: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:convene:project-options",
      tag: WS_METHODS.conveneProjectOptions,
    }),
  };
}
