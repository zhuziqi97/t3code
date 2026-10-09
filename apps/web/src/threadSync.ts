import type { TFunction } from "i18next";
import { i18n } from "./i18n";
import type { EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";

export type ThreadSyncPhase = "loading" | "syncing";

export function resolveThreadSyncPhase(input: {
  readonly detailExists: boolean;
  readonly shellExists: boolean;
  readonly status: EnvironmentThreadStatus;
}): ThreadSyncPhase | null {
  if (!input.shellExists) {
    return null;
  }

  switch (input.status) {
    case "empty":
    case "cached":
    case "synchronizing":
      return input.detailExists ? "syncing" : "loading";
    case "deleted":
    case "live":
      return null;
  }
}

export function threadSyncLabel(phase: ThreadSyncPhase, t: TFunction = i18n.t): string {
  return phase === "loading" ? t("chat.sync.loading") : t("chat.sync.syncing");
}
