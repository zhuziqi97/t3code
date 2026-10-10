import { useTranslate } from "../../i18n";
import { Spinner } from "~/components/ui/spinner";
import type { ServerUpdateState } from "@t3tools/client-runtime/state/server";
import { CircleAlertIcon, DownloadIcon } from "lucide-react";
import { useId, useState } from "react";

import { formatServerUpdateMessage, serverUpdateStageLabel } from "../ServerUpdateAction.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerBanner } from "./ComposerBanner";

export function ComposerServerUpdateIcon({
  status,
}: {
  readonly status: ServerUpdateState["status"];
}) {
  if (status === "running") {
    return <Spinner aria-hidden />;
  }
  if (status === "failed") {
    return <CircleAlertIcon aria-hidden className="text-error" />;
  }
  return <DownloadIcon aria-hidden />;
}

/** One text line, clipped at the end so the error detail never squeezes its title. */
export function ComposerServerUpdateStatus({
  state,
  serverLabel,
}: {
  readonly state: Exclude<ServerUpdateState, { status: "idle" }>;
  readonly serverLabel?: string;
}) {
  const t = useTranslate();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const triggerId = useId();
  const title = t(
    state.status === "failed" ? "server.update.environmentFailedPrefix" : "server.update.updating",
    { server: serverLabel ?? t("server.update.server") },
  );
  const detail =
    state.status === "failed"
      ? formatServerUpdateMessage(state.message, t)
      : serverUpdateStageLabel(state.stage, t);
  return (
    <span
      role={state.status === "failed" ? "alert" : "status"}
      className="min-w-0"
      data-composer-server-update-status={state.status}
    >
      <Tooltip open={detailsOpen} onOpenChange={setDetailsOpen} triggerId={triggerId}>
        <TooltipTrigger
          id={triggerId}
          closeOnClick={false}
          render={
            <button
              type="button"
              aria-label={`${title}: ${detail}`}
              className="block max-w-full cursor-help truncate rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setDetailsOpen(true)}
            >
              {title}
              <ComposerBanner.Separator />
              <span className="font-normal text-muted-foreground">{detail}</span>
            </button>
          }
        />
        <TooltipPopup side="top">
          {title}: {detail}
        </TooltipPopup>
      </Tooltip>
    </span>
  );
}
