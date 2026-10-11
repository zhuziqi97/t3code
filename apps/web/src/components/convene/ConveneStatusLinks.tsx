import { useTranslate } from "../../i18n";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEnvironments } from "~/state/environments";
import { Button } from "../ui/button";
import { SidebarFooter } from "../ui/sidebar";
import { useConveneStatus } from "./ConveneConnectionPanel";

function EnvironmentStatus({
  environmentId,
  label,
}: {
  environmentId: EnvironmentId;
  label: string;
}) {
  const t = useTranslate();
  const result = useConveneStatus(environmentId);
  const phase = AsyncResult.isSuccess(result) ? result.value.phase : "unavailable";
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start"
      render={<Link to="/settings/convene" search={{ machine: environmentId }} />}
      aria-label={`Convene ${label}: ${t(`convene.status.${phase}`)}`}
    >
      <span className="truncate">
        Convene · {label} ·{" "}
        {phase === "online"
          ? t("convene.status.online")
          : phase === "connecting"
            ? t("convene.status.connecting")
            : phase === "unpaired"
              ? t("convene.status.unpaired")
              : phase === "offline"
                ? t("convene.status.offline")
                : t("convene.status.unavailable")}
      </span>
    </Button>
  );
}
export function ConveneStatusLinks() {
  const { environments } = useEnvironments();
  return (
    <SidebarFooter>
      {environments.map((environment) => (
        <EnvironmentStatus
          key={environment.environmentId}
          environmentId={environment.environmentId}
          label={environment.label}
        />
      ))}
    </SidebarFooter>
  );
}
