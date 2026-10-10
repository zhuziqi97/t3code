import type { Announcements } from "@dnd-kit/core";
import { useMemo } from "react";
import { useTranslate } from "../i18n";

export function useDndAccessibility() {
  const t = useTranslate();
  return useMemo(() => {
    const announcements: Announcements = {
      onDragStart: ({ active }) => t("drag.pickedUp", { id: active.id }),
      onDragOver: ({ active, over }) =>
        over
          ? t("drag.movedOver", { id: active.id, target: over.id })
          : t("drag.movedOutside", { id: active.id }),
      onDragEnd: ({ active, over }) =>
        over
          ? t("drag.droppedOver", { id: active.id, target: over.id })
          : t("drag.dropped", { id: active.id }),
      onDragCancel: ({ active }) => t("drag.cancelled", { id: active.id }),
    };
    return {
      announcements,
      screenReaderInstructions: { draggable: t("drag.instructions") },
    };
  }, [t]);
}
