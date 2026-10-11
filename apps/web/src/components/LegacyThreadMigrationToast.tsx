import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef } from "react";
import { i18n, useTranslate } from "../i18n";

import { primaryServerLegacyThreadMigrationAtom } from "../state/server";
import { toastManager } from "./ui/toast";

type MigrationToastId = ReturnType<typeof toastManager.add>;

export function LegacyThreadMigrationToast() {
  const t = useTranslate();
  const migration = useAtomValue(primaryServerLegacyThreadMigrationAtom);
  const toastIdRef = useRef<MigrationToastId | null>(null);

  useEffect(() => {
    if (migration?.status === "running") {
      const options = {
        type: "loading" as const,
        title: t("migration.restoring"),
        description: t("migration.description", {
          count: migration.totalThreadCount,
          total: migration.totalThreadCount.toLocaleString(i18n.resolvedLanguage ?? i18n.language),
        }),
        timeout: 0,
      };
      if (toastIdRef.current === null) toastIdRef.current = toastManager.add(options);
      else toastManager.update(toastIdRef.current, options);
      return;
    }

    if (toastIdRef.current !== null) {
      toastManager.close(toastIdRef.current);
      toastIdRef.current = null;
    }
  }, [migration, t]);

  useEffect(
    () => () => {
      if (toastIdRef.current !== null) {
        toastManager.close(toastIdRef.current);
      }
    },
    [],
  );

  return null;
}
