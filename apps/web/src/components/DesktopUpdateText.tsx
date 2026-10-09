import type { TFunction } from "i18next";
import { useTranslate } from "../i18n";

// The toast manager retains React nodes; translate them at render time.
export function DesktopUpdateText({ render }: { render: (t: TFunction) => string }) {
  return render(useTranslate());
}
