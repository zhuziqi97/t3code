import { AsyncResult, Atom } from "effect/reactivity";

import { environmentCatalog } from "../../connection/catalog";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { webBasePath, webRequestBasePath } from "../../webBasePath";

const primaryConnectionAtom = Atom.make((get) => {
  const environmentId = get(primaryEnvironmentIdAtom);
  return environmentId === null
    ? null
    : AsyncResult.getOrElse(get(environmentCatalog.stateAtom(environmentId)), () => null);
});

export async function conveneSessionNeedsNavigation(response: Response): Promise<boolean> {
  if (response.ok) return false;
  const body: { code?: unknown; detail?: { reason?: unknown } } | null = await response.json();
  return (
    (response.status === 401 &&
      (body?.code === "REMOTE_SESSION_EXPIRED" || body?.code === "REMOTE_SESSION_NOT_FOUND")) ||
    (body?.code === "REMOTE_SESSION_UNAVAILABLE" && body.detail?.reason === "CLIENT_BUILD_CHANGED")
  );
}

async function sessionExpired(requestBase: string, signal: AbortSignal): Promise<boolean> {
  const response = await fetch(`${requestBase}/api/auth/session`, {
    cache: "no-store",
    redirect: "error",
    signal,
  });
  return conveneSessionNeedsNavigation(response);
}

export function startConveneSessionRecovery(): void {
  const navigationBase = webBasePath();
  const requestBase = webRequestBasePath();
  if (!navigationBase || !requestBase.startsWith(`${navigationBase}/_sessions/`)) return;

  let wasConnected = false;
  let checking: AbortController | undefined;
  appAtomRegistry.subscribe(
    primaryConnectionAtom,
    (state) => {
      if (state?.phase === "connected") {
        wasConnected = true;
        checking?.abort();
        checking = undefined;
      }
      // A page that never connected must not loop through navigation at startup.
      if (
        !wasConnected ||
        checking ||
        state?.network === "offline" ||
        (state?.phase !== "backoff" && state?.phase !== "blocked")
      )
        return;

      const probe = new AbortController();
      checking = probe;
      void sessionExpired(requestBase, probe.signal)
        .then((expired) => {
          // Let the stable device page mint a new session and serve its matching build.
          if (expired && !probe.signal.aborted) window.location.reload();
        })
        .catch(() => {})
        .finally(() => {
          if (checking === probe) checking = undefined;
        });
    },
    { immediate: true },
  );
}
