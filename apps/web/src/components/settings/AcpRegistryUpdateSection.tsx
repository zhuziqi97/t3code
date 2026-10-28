import { useAtomValue } from "@effect/atom-react";
import {
  runAcpRegistryUpdate,
  type AcpRegistryUpdateState,
} from "@t3tools/client-runtime/acp-registry-update";
import type {
  EnvironmentId,
  ProviderInstanceId,
  ServerProviderVersionAdvisory,
  AcpRegistryDistribution,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
import { useTranslate } from "../../i18n";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { SettingsRow } from "./settingsLayout";

export function AcpRegistryUpdateSection({
  environmentId,
  instanceId,
  agentId,
  distribution,
  advisory,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly agentId: string;
  readonly distribution?: AcpRegistryDistribution | undefined;
  readonly advisory?: ServerProviderVersionAdvisory | undefined;
  readonly readOnly: boolean;
}) {
  const t = useTranslate();
  const canPrepare = useAtomValue(
    serverEnvironment.prepareAcpRegistryAgent.permissionAtom(environmentId),
  );
  const prepare = useAtomCommand(serverEnvironment.prepareAcpRegistryAgent, {
    reportFailure: false,
  });
  const refresh = useAtomCommand(serverEnvironment.refreshProviders, { reportFailure: false });
  const [state, setState] = useState<AcpRegistryUpdateState>({ phase: "idle" });
  const pendingRef = useRef(false);
  const pending = state.phase === "preparing" || state.phase === "refreshing";
  const description =
    state.phase === "failed"
      ? `${t(state.stage === "prepare" ? "provider.registry.update.prepareFailed" : "provider.registry.update.refreshFailed")}${state.error ? ` ${state.error}` : ""}`
      : t(
          state.phase === "succeeded"
            ? "provider.registry.update.succeeded"
            : "provider.registry.update.description",
        );
  async function update() {
    if (readOnly || !canPrepare || pendingRef.current) return;
    pendingRef.current = true;
    await runAcpRegistryUpdate(
      { environmentId, instanceId, agentId, distribution },
      state,
      { prepare, refresh },
      setState,
    );
    pendingRef.current = false;
  }
  return (
    <SettingsRow
      title={t("provider.registry.update.title")}
      description={
        <span className="grid gap-1">
          <span role={state.phase === "failed" ? "alert" : "status"}>{description}</span>
          {state.phase === "idle" && advisory?.status !== "behind_latest" && advisory?.message ? (
            <span>{advisory.message}</span>
          ) : null}
          {advisory?.checkedAt ? (
            <span>{t("provider.registry.update.lastChecked", { time: advisory.checkedAt })}</span>
          ) : null}
        </span>
      }
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={readOnly || !canPrepare || pending}
          onClick={() => void update()}
        >
          {pending ? <Spinner /> : null}
          {t(
            state.phase === "preparing"
              ? "provider.instance.updating"
              : state.phase === "refreshing"
                ? "provider.registry.update.refreshing"
                : state.phase === "failed"
                  ? state.stage === "refresh"
                    ? "provider.registry.update.retryRefresh"
                    : "provider.registry.update.retry"
                  : "provider.registry.update.action",
          )}
        </Button>
      }
    />
  );
}
