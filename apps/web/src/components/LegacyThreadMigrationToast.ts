import { msg } from "gt-react";

import { getActiveLocale, m } from "../i18n/messages";
import { subscribeI18n } from "../i18n/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryServerLegacyThreadMigrationAtom } from "../state/server";
import { toastManager } from "./ui/toast";

type MigrationToastId = ReturnType<typeof toastManager.add>;

/** A loading toast for as long as the primary server reports a legacy thread migration running. */
export function startLegacyThreadMigrationToast(): () => void {
  let toastId: MigrationToastId | null = null;

  const render = () => {
    const migration = appAtomRegistry.get(primaryServerLegacyThreadMigrationAtom);
    if (migration?.status === "running") {
      const options = {
        type: "loading" as const,
        title: m(msg("Restoring your threads…")),
        description: m(
          msg(
            "{count, plural, one {Migrating {total} thread from the previous version. You can keep working while this finishes.} other {Migrating {total} threads from the previous version. You can keep working while this finishes.}}",
            {
              count: migration.totalThreadCount,
              total: migration.totalThreadCount.toLocaleString(getActiveLocale()),
            },
          ),
        ),
        timeout: 0,
      };
      if (toastId === null) toastId = toastManager.add(options);
      else toastManager.update(toastId, options);
    } else if (toastId !== null) {
      toastManager.close(toastId);
      toastId = null;
    }
  };

  const unsubscribe = appAtomRegistry.subscribe(primaryServerLegacyThreadMigrationAtom, render, {
    immediate: true,
  });
  const unsubscribeLocale = subscribeI18n(render);
  return () => {
    unsubscribe();
    unsubscribeLocale();
    if (toastId !== null) toastManager.close(toastId);
  };
}
