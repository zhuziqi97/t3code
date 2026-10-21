import { createWorkspaceRecoveryAtoms } from "@t3tools/client-runtime/state/workspaceRecovery";
import { connectionAtomRuntime } from "../connection/runtime";

export const workspaceRecoveryEnvironment = createWorkspaceRecoveryAtoms(connectionAtomRuntime);
