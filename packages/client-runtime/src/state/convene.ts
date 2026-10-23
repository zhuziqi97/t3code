import { WS_METHODS, type ProjectId, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { request } from "../rpc/client.ts";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
  createEnvironmentQueryAtomFamily,
} from "./runtime.ts";

const readProjectView = Effect.fn("Convene.projectView")((projectId: ProjectId) =>
  request(WS_METHODS.conveneQueryProject, { projectId }),
);

export function createConveneEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const resourceChanges = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:convene:resource-changes",
    tag: WS_METHODS.conveneSubscribeResourceChanges,
  });
  return {
    projectView: createEnvironmentQueryAtomFamily(runtime, {
      label: "environment-data:convene:project-view",
      execute: (input: { projectId: ProjectId; workspacePath: string; threadId?: ThreadId }) =>
        readProjectView(input.projectId),
      staleTimeMs: 0,
      idleTtlMs: 0,
      refreshTrigger: ({ environmentId, input }) =>
        input.threadId
          ? resourceChanges({ environmentId, input: { threadId: input.threadId } })
          : undefined,
    }),
    searchResources: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:convene:search-resources",
      tag: WS_METHODS.conveneSearchResources,
    }),
    resourceChanges,
    readResource: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:convene:read-resource",
      tag: WS_METHODS.conveneReadResource,
    }),
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
