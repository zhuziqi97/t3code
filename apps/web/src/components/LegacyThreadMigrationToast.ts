import { i18n } from "../i18n";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryServerLegacyThreadMigrationAtom } from "../state/server";
import { toastManager } from "./ui/toast";

type MigrationToastId = ReturnType<typeof toastManager.add>;

export function startLegacyThreadMigrationToast(): () => void {
  let toastId: MigrationToastId | null = null;
  const render = () => {
    const migration = appAtomRegistry.get(primaryServerLegacyThreadMigrationAtom);
    if (migration?.status === "running") {
      const options = {
        type: "loading" as const,
        title: i18n.t("migration.restoring"),
        description: i18n.t("migration.description", {
          count: migration.totalThreadCount,
          total: migration.totalThreadCount.toLocaleString(i18n.resolvedLanguage ?? i18n.language),
        }),
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
  i18n.on("languageChanged", render);
  return () => {
    unsubscribe();
    i18n.off("languageChanged", render);
    if (toastId !== null) toastManager.close(toastId);
  };
}
