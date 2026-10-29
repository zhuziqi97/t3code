import { useAtomValue } from "@effect/atom-react";
import {
  runAcpRegistryUpdate,
  managedAcpRegistryUpdateTarget,
  type AcpRegistryUpdateState,
} from "@t3tools/client-runtime/acp-registry-update";
import type {
  EnvironmentId,
  ProviderInstanceId,
  ProviderInstanceConfig,
  ServerProviderVersionAdvisory,
  AcpRegistryDistribution,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { useTranslate } from "../../i18n";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ListActionRow } from "../../components/ui/ListActionRow";

export function AcpRegistryUpdateRow({
  instance,
  ...props
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig | undefined;
  readonly advisory?: ServerProviderVersionAdvisory | undefined;
  readonly disabled: boolean;
}) {
  const target = managedAcpRegistryUpdateTarget(instance);
  return target === null ? null : (
    <AcpRegistryUpdateAction
      key={`${props.environmentId}:${props.instanceId}:${target.agentId}:${target.distribution ?? "auto"}`}
      {...props}
      {...target}
    />
  );
}

function AcpRegistryUpdateAction({
  environmentId,
  instanceId,
  agentId,
  distribution,
  advisory,
  disabled,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly agentId: string;
  readonly distribution?: AcpRegistryDistribution | undefined;
  readonly advisory?: ServerProviderVersionAdvisory | undefined;
  readonly disabled: boolean;
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
    if (disabled || !canPrepare || pendingRef.current) return;
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
    <View>
      <Text
        accessibilityRole={state.phase === "failed" ? "alert" : undefined}
        accessibilityLiveRegion="polite"
        className="px-4 text-sm text-foreground-muted"
      >
        {description}
      </Text>
      {state.phase === "idle" && advisory?.message ? (
        <Text className="px-4 text-sm text-foreground-muted">{advisory.message}</Text>
      ) : null}
      {advisory?.checkedAt && advisory.status !== "behind_latest" ? (
        <Text className="px-4 text-sm text-foreground-muted">
          {t("provider.registry.update.lastChecked", { time: advisory.checkedAt })}
        </Text>
      ) : null}
      <ListActionRow
        icon="arrow.down.circle"
        label={t(
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
        disabled={disabled || !canPrepare || pending}
        loading={pending}
        onPress={() => void update()}
      />
    </View>
  );
}
