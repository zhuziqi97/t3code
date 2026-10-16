import { showBootError } from "./lib/bootError";
import { chunkLoadRecovery, watchChunkLoadErrors } from "./lib/chunkReloadGuard";

watchChunkLoadErrors();

// Bundled dev can move UI code into shared chunks. Load it only after this
// entry runs the React refresh preamble, and catch failures before React mounts.
void import("./main")
  .then(({ startup }) => startup)
  .catch((error: unknown) => {
    if (!chunkLoadRecovery.reloading) return showBootError(error);
  });
