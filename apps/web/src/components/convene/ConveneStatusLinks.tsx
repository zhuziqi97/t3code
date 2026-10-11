import { useTranslate } from "../../i18n";
import { Link } from "@tanstack/react-router";
import { Link2Icon, LoaderCircleIcon, UnplugIcon } from "lucide-react";
import { AsyncResult } from "effect/reactivity";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useConveneStatus } from "./ConveneConnectionPanel";

function EnvironmentStatus({
  environmentId,
  label,
}: {
  environmentId: EnvironmentId;
  label: string;
}) {
  const t = useTranslate();
  const { isMobile, setOpenMobile } = useSidebar();
  const result = useConveneStatus(environmentId);
  const phase = AsyncResult.isSuccess(result) ? result.value.phase : "unavailable";
  const description = `Convene · ${label} · ${t(`convene.status.${phase}`)}`;
  const Icon =
    phase === "connecting" ? LoaderCircleIcon : phase === "online" ? Link2Icon : UnplugIcon;
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              size="icon"
              aria-label={description}
              render={<Link to="/settings/convene" search={{ machine: environmentId }} />}
              onClick={() => {
                if (isMobile) setOpenMobile(false);
              }}
            >
              <Icon className={phase === "connecting" ? "animate-spin" : undefined} />
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{description}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

/** Matches the environment initially shown by the Convene settings page. */
export function ConveneStatusLinks() {
  const { environments } = useEnvironments();
  const primaryId = usePrimaryEnvironmentId();
  const environment =
    environments.find((item) => item.environmentId === primaryId) ?? environments[0];
  return environment ? (
    <EnvironmentStatus environmentId={environment.environmentId} label={environment.label} />
  ) : null;
}
