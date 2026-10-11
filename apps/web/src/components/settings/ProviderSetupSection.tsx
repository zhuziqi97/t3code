import type { TFunction } from "i18next";
import { i18n, useTranslate } from "../../i18n";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  ANTIGRAVITY_AUTH_METHODS,
  type AntigravityAuthMethod,
  type EnvironmentId,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Trash2Icon } from "lucide-react";

import { ensureLocalApi } from "../../localApi";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsRow } from "./settingsLayout";
import { ProviderAuthenticationSection } from "./ProviderAuthenticationSection";

interface ProviderSetupSectionProps {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider | undefined;
  readonly binaryPath?: string | undefined;
  readonly authMethod?: AntigravityAuthMethod | undefined;
  readonly enabled: boolean;
  readonly readOnly: boolean;
  readonly onEnable: () => void;
}

/** Read the configured method from the instance config. Unknown values fall back to personal. */
export function readAntigravityAuthMethod(config: unknown): AntigravityAuthMethod {
  const value =
    config !== null && typeof config === "object" && "authMethod" in config
      ? config.authMethod
      : undefined;
  return (
    ANTIGRAVITY_AUTH_METHODS.find((method) => method.value === value)?.value ?? "oauth-personal"
  );
}

/** Setup state belongs to the selected environment and is never saved in client settings. */
export function ProviderSetupSection(props: ProviderSetupSectionProps) {
  const t = useTranslate();
  return (
    <section
      aria-label={t("provider.setup.setupTitle")}
      className="@container/setup divide-y divide-border/50 text-xs"
    >
      <SettingsRow
        className="@max-lg/setup:[&>div:first-child]:flex @max-lg/setup:[&>div:first-child]:items-stretch @max-lg/setup:[&>div:first-child]:gap-3"
        title={t("provider.setup.environment")}
        description={t("provider.setup.environmentDescription")}
        control={
          <div className="flex min-w-0 flex-col gap-2 sm:items-end">
            <span className="text-muted-foreground [overflow-wrap:anywhere]">
              {props.environmentLabel}
            </span>
            {!props.enabled && !props.readOnly ? (
              <Button size="sm" variant="outline" onClick={props.onEnable}>
                {t("provider.setup.enableAntigravity")}
              </Button>
            ) : null}
          </div>
        }
      />
      {props.readOnly ? (
        <SettingsRow
          title={t("provider.setup.setupUnavailable")}
          description={t("provider.setup.readOnly")}
        />
      ) : props.provider?.setup === undefined ? (
        <SettingsRow
          title={t("provider.setup.updateRequired")}
          description={t("provider.setup.updateEnvironment")}
        />
      ) : (
        <ProviderSetupActions
          key={`${props.environmentId}:${props.instanceId}`}
          environmentId={props.environmentId}
          environmentLabel={props.environmentLabel}
          instanceId={props.instanceId}
          provider={props.provider}
          binaryPath={props.binaryPath}
          authMethod={props.authMethod ?? "oauth-personal"}
          enabled={props.enabled}
        />
      )}
    </section>
  );
}

function ProviderSetupActions({
  environmentId,
  environmentLabel,
  instanceId,
  provider,
  enabled,
  binaryPath,
}: Pick<
  ProviderSetupSectionProps,
  "environmentId" | "environmentLabel" | "instanceId" | "enabled" | "binaryPath"
> & {
  readonly provider: ServerProvider;
  readonly authMethod: AntigravityAuthMethod;
}) {
  const t = useTranslate();
  const target = { environmentId, input: { instanceId } };
  const authQuery = useEnvironmentQuery(serverEnvironment.providerAuthState(target));
  const installQuery = useEnvironmentQuery(serverEnvironment.providerInstallState(target));
  const auth = authQuery.data;
  const installation = installQuery.data;
  const commandOptions = { reportFailure: false, reportDefect: false };
  const startInstall = useAtomCommand(serverEnvironment.startProviderInstall, commandOptions);
  const cancelInstall = useAtomCommand(serverEnvironment.cancelProviderInstall, commandOptions);
  const removeInstall = useAtomCommand(
    serverEnvironment.removeProviderInstallation,
    commandOptions,
  );
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | { readonly key: string } | null>(null);
  const authActive =
    auth?.phase === "starting" || auth?.phase === "waiting" || auth?.phase === "verifying";
  const installActive =
    installation?.phase === "downloading" ||
    installation?.phase === "extracting" ||
    installation?.phase === "verifying";
  const usesCustomBinary = Boolean(binaryPath?.trim());
  const installed =
    provider.installed || (!usesCustomBinary && installation?.installedVersion != null);
  const queryError = authQuery.error ?? installQuery.error;
  const actionsDisabled = pendingLabel !== null || queryError !== null;
  const installationStatusMessageFor = (translate: TFunction) =>
    installation?.phase === "downloading"
      ? installation.totalBytes === null
        ? translate("provider.setup.downloading", {
            downloaded: (installation.downloadedBytes / 1_000_000).toFixed(1),
          })
        : translate("provider.setup.downloadingTotal", {
            downloaded: (installation.downloadedBytes / 1_000_000).toFixed(1),
            total: (installation.totalBytes / 1_000_000).toFixed(1),
          })
      : installation?.phase === "extracting"
        ? translate("provider.setup.extracting")
        : installation?.phase === "verifying"
          ? translate("provider.setup.verifying")
          : installed
            ? translate("provider.setup.installed")
            : usesCustomBinary
              ? enabled
                ? translate("provider.setup.customUnavailable")
                : translate("provider.setup.customUnchecked")
              : installation?.totalBytes
                ? translate("provider.setup.downloadSize", {
                    size: Math.ceil(installation.totalBytes / 1_000_000),
                  })
                : translate("provider.setup.notInstalled");
  const installationStatusMessage = installationStatusMessageFor(t);
  const sourceInstallationStatusMessage = installationStatusMessageFor(i18n.getFixedT("en"));

  async function runCommand<A, E>(
    label: string,
    request: () => Promise<AtomCommandResult<A, E>>,
  ): Promise<boolean> {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPendingLabel(label);
    setError(null);
    try {
      const result = await request();
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          setError(
            failure instanceof Error ? failure.message : { key: "provider.setup.setupFailed" },
          );
        }
        return false;
      }
      return true;
    } catch {
      setError({ key: "provider.setup.setupRetryFailed" });
      return false;
    } finally {
      pendingRef.current = false;
      setPendingLabel(null);
    }
  }

  async function removeRuntime() {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      t("provider.setup.removeRuntimeQuestion", { environment: environmentLabel }),
    );
    if (confirmed) {
      await runCommand("provider.setup.removingStatus", () => removeInstall(target));
    }
  }

  return (
    <div className="divide-y divide-border/50">
      <SettingsRow
        title={t("provider.setup.runtime")}
        className="@max-lg/setup:[&>div:first-child]:flex @max-lg/setup:[&>div:first-child]:items-stretch @max-lg/setup:[&>div:first-child]:gap-3"
        description={t("provider.setup.runtimeDescription")}
        status={
          <div className="space-y-2">
            {usesCustomBinary ? (
              <p className="text-muted-foreground">{t("provider.setup.customPathHint")}</p>
            ) : null}
            {!installed && !provider.setup?.canInstall ? (
              <p className="text-muted-foreground">{t("provider.setup.manualInstallHint")}</p>
            ) : null}
          </div>
        }
        control={
          <div className="flex w-full min-w-0 flex-col gap-2 sm:w-56 sm:text-right">
            <p role="status" className="min-h-4 text-muted-foreground tabular-nums">
              {installationStatusMessage}
            </p>
            <div className="h-1">
              {installation?.phase === "downloading" &&
              installation.totalBytes !== null &&
              installation.totalBytes > 0 ? (
                <progress
                  aria-label={t("provider.setup.downloadProgress")}
                  className="block h-1 w-full accent-foreground"
                  value={installation.downloadedBytes}
                  max={installation.totalBytes}
                />
              ) : null}
            </div>
            {!installActive &&
            installation?.message &&
            installation.message !== sourceInstallationStatusMessage ? (
              <p className="text-muted-foreground [overflow-wrap:anywhere]">
                {installation.message}
              </p>
            ) : null}
            <div className="grid min-h-7 grid-cols-[1.75rem_minmax(0,1fr)] gap-2">
              <div className="col-start-2 row-start-1 grid">
                {installActive && installation.operationId ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={actionsDisabled}
                    onClick={() => {
                      const operationId = installation.operationId;
                      if (!operationId) return;
                      void runCommand("provider.setup.cancellingStatus", () =>
                        cancelInstall({ environmentId, input: { instanceId, operationId } }),
                      );
                    }}
                  >
                    {t("provider.setup.cancelInstallation")}
                  </Button>
                ) : !installActive && provider.setup?.canInstall ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={actionsDisabled || installation === null || authActive}
                    onClick={() =>
                      void runCommand("provider.setup.startingStatus", () => startInstall(target))
                    }
                  >
                    {installation?.installedVersion
                      ? installation.version &&
                        installation.version !== installation.installedVersion
                        ? t("provider.setup.updateAntigravity")
                        : t("provider.setup.reinstallAntigravity")
                      : installation?.phase === "failed" || installation?.phase === "cancelled"
                        ? t("provider.setup.retryInstallation")
                        : installed
                          ? t("provider.setup.installManaged")
                          : t("provider.setup.installAntigravity")}
                  </Button>
                ) : null}
              </div>
              {installation?.canRemove && !installActive ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="col-start-1 row-start-1"
                        aria-label={t("provider.setup.removeRuntime")}
                        disabled={actionsDisabled || authActive}
                        onClick={() => void removeRuntime()}
                      />
                    }
                  >
                    <Trash2Icon className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipPopup>{t("provider.setup.removeRuntime")}</TooltipPopup>
                </Tooltip>
              ) : null}
            </div>
          </div>
        }
      />

      <ProviderAuthenticationSection
        environmentId={environmentId}
        environmentLabel={environmentLabel}
        instanceId={instanceId}
        provider={provider}
        readOnly={false}
      />

      <p className="sr-only" role="status">
        {pendingLabel ? t(pendingLabel) : null}
      </p>
      {error || queryError ? (
        <div className="grid gap-2 px-3 py-3 sm:px-4">
          <p role="alert" className="text-destructive [overflow-wrap:anywhere]">
            {typeof error === "object" && error !== null ? t(error.key) : (error ?? queryError)}
          </p>
          {queryError ? (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => {
                authQuery.refresh();
                installQuery.refresh();
              }}
            >
              {t("provider.setup.retrySetup")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
