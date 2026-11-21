import { useMessages } from "gt-react";
import type { MessageResolver } from "../i18n/messages";

// Toasts retain their content after creation; translate it when it renders.
export function ProviderUpdateText({ render }: { render: (resolve: MessageResolver) => string }) {
  return render(useMessages());
}
