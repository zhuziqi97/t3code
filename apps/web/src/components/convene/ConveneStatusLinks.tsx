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
  const result = useConveneStatus(environmentId);
  const phase = AsyncResult.isSuccess(result) ? result.value.phase : "unavailable";
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start"
      render={<Link to="/settings/convene" search={{ machine: environmentId }} />}
      aria-label={`Convene ${label}: ${phase}`}
    >
      <span className="truncate">
        Convene · {label} ·{" "}
        {phase === "online"
          ? "Connected"
          : phase === "connecting"
            ? "Connecting"
            : phase === "unpaired"
              ? "Connect"
              : phase === "offline"
                ? "Offline"
                : "Unavailable"}
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
