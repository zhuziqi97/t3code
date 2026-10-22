import { createConveneEnvironmentAtoms } from "@t3tools/client-runtime/state/convene";
import { connectionAtomRuntime } from "../connection/runtime";

export const conveneEnvironment = createConveneEnvironmentAtoms(connectionAtomRuntime);
