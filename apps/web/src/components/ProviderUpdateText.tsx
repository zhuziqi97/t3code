import type { TFunction } from "i18next";
import { useTranslate } from "../i18n";

// Toasts retain their content after creation; translate it when it renders.
export function ProviderUpdateText({ render }: { render: (t: TFunction) => string }) {
  return render(useTranslate());
}
