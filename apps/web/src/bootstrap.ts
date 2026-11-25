import { showBootError } from "./lib/bootError";
import { chunkLoadRecovery, watchChunkLoadErrors } from "./lib/chunkReloadGuard";

watchChunkLoadErrors();

// Shared dev chunks need the React refresh preamble first. Catch failures before React mounts.
export const boot = import("./main")
  .then(({ startup }) => startup)
  .catch((error: unknown) => {
    if (!chunkLoadRecovery.reloading) return showBootError(error);
  });
