import { useAtomValue } from "@effect/atom-react";
import {
  AuthEnvironmentMaintainScope,
  type AuthSessionState,
  sessionGrantsScope,
} from "@t3tools/contracts";
import type { AsyncResult } from "effect/reactivity";
import { environmentSession } from "~/state/session";
import type {
  EnvironmentId,
  ServerInstallation,
  ServerSelfUpdateCapability,
} from "@t3tools/contracts";
import type { ServerUpdateState } from "@t3tools/client-runtime/state/server";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { CircleArrowUpIcon } from "lucide-react";
import { type ComponentProps, useRef, useState } from "react";
import * as Schema from "effect/Schema";

import { requestConfirmDialog } from "~/confirmDialog";
import {
  ClipboardApiUnavailableError,
  ClipboardWriteError,
  useCopyToClipboard,
} from "~/hooks/useCopyToClipboard";
import { i18n, useTranslate } from "../i18n";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { serverEnvironment, updateOutdatedServer } from "~/state/server";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useAtomCommand } from "~/state/use-atom-command";
import { manualServerUpdateCommand } from "~/versionSkew";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { formatServerUpdateMessage, serverUpdateStageLabel } from "./ServerUpdateAction.logic";

const pendingUpdateEnvironmentIds = new Set<EnvironmentId>();
const isClipboardApiUnavailable = Schema.is(ClipboardApiUnavailableError);
const isClipboardWriteError = Schema.is(ClipboardWriteError);

function updateFailureMessage(error: unknown): string {
  return error instanceof Error
    ? formatServerUpdateMessage(error.message, i18n.t)
    : i18n.t("server.update.failedMessage");
}

export interface ServerUpdateTarget {
  readonly environmentId: EnvironmentId;
  readonly serverLabel: string;
  readonly selfUpdate: ServerSelfUpdateCapability | null;
  readonly installation?: ServerInstallation | undefined;
  readonly desktopAppUpdate?: boolean;
  readonly threadContinuation?: boolean;
  readonly targetVersion: string;
  readonly continueThreadsAfterServerUpdate?: boolean;
}

type UpdateButtonProps = Pick<ComponentProps<typeof Button>, "variant" | "size" | "className"> & {
  readonly label?: string;
  /** "icon" renders a compact icon button with the label in a tooltip. */
  readonly appearance?: "button" | "icon";
};

function useServerUpdate() {
  const updateServer = useAtomCommand(serverEnvironment.updateServer, { reportFailure: false });
  return async (target: ServerUpdateTarget, failureTitle?: () => string) => {
    const { environmentId, serverLabel, selfUpdate, targetVersion } = target;
    if (
      !canUpdateServer(appAtomRegistry.get(environmentSession.sessionStateAtom(environmentId))) ||
      pendingUpdateEnvironmentIds.has(environmentId)
    )
      return;
    pendingUpdateEnvironmentIds.add(environmentId);
    try {
      const result = await updateServer({
        environmentId,
        input: {
          targetVersion,
          ...(target.threadContinuation && target.continueThreadsAfterServerUpdate
            ? { continueRunningThreads: true }
            : {}),
        },
      });
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        throw squashAtomCommandFailure(result);
      }
      toastManager.add({
        type: "success",
        title: i18n.t("server.update.updated", { server: serverLabel }),
        description:
          selfUpdate === "desktop-managed"
            ? i18n.t("server.update.relaunched", { version: result.value.targetVersion })
            : i18n.t("server.update.reconnected", { version: result.value.targetVersion }),
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: failureTitle?.() ?? i18n.t("server.update.failed"),
        description: updateFailureMessage(error),
      });
    } finally {
      pendingUpdateEnvironmentIds.delete(environmentId);
    }
  };
}

/** Updates eligible machines independently; manual paths remain in the machine list. */
export function ServerUpdatesAction({
  targets,
  label,
  variant = "outline",
  size = "xs",
  className,
}: UpdateButtonProps & {
  readonly targets: ReadonlyArray<ServerUpdateTarget>;
}) {
  const t = useTranslate();
  const update = useServerUpdate();
  const pending = useRef(false);
  const [isPending, setIsPending] = useState(false);
  const eligible = targets.filter(
    (target) =>
      target.selfUpdate !== null &&
      (target.selfUpdate !== "desktop-managed" || target.desktopAppUpdate),
  );
  const handleUpdate = async () => {
    if (pending.current) return;
    pending.current = true;
    setIsPending(true);
    try {
      const available = eligible.filter(
        (target) => !pendingUpdateEnvironmentIds.has(target.environmentId),
      );
      const desktopTargets = available.filter((target) => target.selfUpdate === "desktop-managed");
      if (desktopTargets.length > 0) {
        const confirmed =
          (await requestConfirmDialog(
            i18n.t("server.update.confirmMany", {
              servers: desktopTargets.map((target) => target.serverLabel).join(", "),
            }),
          )) ?? true;
        if (!confirmed) return;
      }
      await Promise.all(
        available.map((target) =>
          update(target, () =>
            i18n.t("server.update.environmentFailed", { server: target.serverLabel }),
          ),
        ),
      );
    } finally {
      pending.current = false;
      setIsPending(false);
    }
  };
  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      disabled={isPending || eligible.length === 0}
      onClick={() => void handleUpdate()}
    >
      {label ?? t("chat.update.all")}
    </Button>
  );
}

function canUpdateServer(result: AsyncResult.AsyncResult<AuthSessionState, unknown>): boolean {
  if (result._tag !== "Success" || !result.value.authenticated) return false;
  return sessionGrantsScope(result.value, AuthEnvironmentMaintainScope);
}

/**
 * One-row status for an in-flight server update: "Downloading…" then
 * "Restarting…". The update is a wait, not a warning: a single pulsing dot
 * and label, no step rail, no versions. Failure turns the row red with the
 * rollback reason.
 */
export function ServerUpdateProgress({
  state,
}: {
  readonly state: Exclude<ServerUpdateState, { status: "idle" }>;
}) {
  const t = useTranslate();
  if (state.status === "failed") {
    return (
      <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-destructive" role="alert">
        <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="min-w-0 truncate">
                {formatServerUpdateMessage(state.message, t)}
              </span>
            }
          />
          <TooltipPopup side="top">{formatServerUpdateMessage(state.message, t)}</TooltipPopup>
        </Tooltip>
      </div>
    );
  }
  return (
    <div className="mt-1 flex items-center gap-2 text-xs font-medium text-foreground">
      <span
        className="size-1.5 shrink-0 animate-status-pulse rounded-full bg-foreground"
        aria-hidden="true"
      />
      <span>{serverUpdateStageLabel(state.stage, t)}</span>
    </div>
  );
}

/**
 * Offers the update path advertised by a version-skewed server. Self-updates
 * delegate their full lifecycle to client-runtime so this component can
 * unmount during reconnect without losing operation state.
 */
export function ServerUpdateAction({
  environmentId,
  serverLabel,
  selfUpdate,
  installation,
  desktopAppUpdate = false,
  threadContinuation = false,
  targetVersion,
  label,
  variant = "outline",
  size = "xs",
  className,
  appearance = "button",
}: Omit<ServerUpdateTarget, "continueThreadsAfterServerUpdate"> & UpdateButtonProps) {
  const t = useTranslate();
  const isDesktopAppUpdate = selfUpdate === "desktop-managed";
  const sessionStateAtom = environmentSession.sessionStateAtom(environmentId);
  const canUpdate = canUpdateServer(useAtomValue(sessionStateAtom));
  const continueThreadsAfterServerUpdate = useEnvironmentSettings(
    environmentId,
    (settings) => settings.continueThreadsAfterServerUpdate,
  );
  const update = useServerUpdate();
  const { copyToClipboard } = useCopyToClipboard<{ command: string }>({
    target: t(
      installation?.kind === "npm-global"
        ? "server.update.command"
        : "server.update.relaunchCommand",
    ),
    onCopy: ({ command }) => {
      toastManager.add({
        type: "success",
        title: i18n.t(
          installation?.kind === "npm-global"
            ? "server.update.commandCopied"
            : "server.update.relaunchCopied",
        ),
        description:
          installation?.kind === "npm-global"
            ? i18n.t("server.update.commandGuidance", { command, server: serverLabel })
            : i18n.t("server.update.relaunchGuidance", { command, server: serverLabel }),
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: i18n.t("server.update.copyFailed"),
        description: isClipboardApiUnavailable(error)
          ? i18n.t("server.update.clipboardUnavailable", {
              target: i18n.t(
                installation?.kind === "npm-global"
                  ? "server.update.command"
                  : "server.update.relaunchCommand",
              ),
            })
          : isClipboardWriteError(error)
            ? i18n.t("server.update.clipboardFailed", {
                target: i18n.t(
                  installation?.kind === "npm-global"
                    ? "server.update.command"
                    : "server.update.relaunchCommand",
                ),
              })
            : error.message,
      });
    },
  });

  const handleUpdate = async () => {
    if (
      !canUpdateServer(appAtomRegistry.get(sessionStateAtom)) ||
      pendingUpdateEnvironmentIds.has(environmentId)
    ) {
      return;
    }
    if (isDesktopAppUpdate) {
      // No themed host mounted (undefined) means proceed: the click itself
      // was the request. This is the only confirmation in the flow; the
      // remote machine installs without asking anyone there.
      const confirmed =
        (await requestConfirmDialog(i18n.t("server.update.confirm", { server: serverLabel }))) ??
        true;
      if (!confirmed) {
        return;
      }
    }
    if (!canUpdateServer(appAtomRegistry.get(sessionStateAtom))) return;
    await update({
      environmentId,
      serverLabel,
      selfUpdate,
      desktopAppUpdate,
      threadContinuation,
      targetVersion,
      continueThreadsAfterServerUpdate,
    });
  };

  if (selfUpdate === "desktop-managed" && !desktopAppUpdate) {
    return (
      <span className="text-muted-foreground text-xs">{t("server.update.manualDesktop")}</span>
    );
  }

  const manualCommand =
    selfUpdate === null ? manualServerUpdateCommand(targetVersion, installation) : null;
  const actionLabel =
    manualCommand !== null
      ? installation?.kind === "npm-global"
        ? t("server.update.copyCommand")
        : t("server.update.copyRelaunch")
      : (label ?? t("connections.update"));
  const onClick =
    manualCommand !== null
      ? () => copyToClipboard(manualCommand, { command: manualCommand })
      : () => void handleUpdate();

  if (appearance === "icon") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost-muted"
              className={className}
              aria-label={t("server.update.actionLabel", {
                action: actionLabel,
                server: serverLabel,
              })}
              disabled={manualCommand === null && !canUpdate}
              onClick={onClick}
            />
          }
        >
          <CircleArrowUpIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="top">{actionLabel}</TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      disabled={manualCommand === null && !canUpdate}
      onClick={onClick}
    >
      {actionLabel}
    </Button>
  );
}

/**
 * Updates a host too old for this client to connect to. Its version comes
 * from the host descriptor because the host never delivers a server config.
 */
export function OutdatedServerUpdateAction({
  environmentId,
  serverLabel,
  fromVersion,
  targetVersion,
  label,
}: {
  readonly environmentId: EnvironmentId;
  readonly serverLabel: string;
  readonly fromVersion: string | undefined;
  readonly targetVersion: string;
  readonly label?: string;
}) {
  const t = useTranslate();
  const update = useAtomCommand(updateOutdatedServer, { reportFailure: false });
  const handleUpdate = async () => {
    if (pendingUpdateEnvironmentIds.has(environmentId)) return;
    pendingUpdateEnvironmentIds.add(environmentId);
    try {
      const result = await update({
        environmentId,
        input: { targetVersion },
        ...(fromVersion === undefined ? {} : { fromVersion }),
      });
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        throw squashAtomCommandFailure(result);
      }
      toastManager.add({
        type: "success",
        title: i18n.t("server.update.updated", { server: serverLabel }),
        description: i18n.t("server.update.reconnected", { version: result.value.targetVersion }),
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: i18n.t("server.update.failed"),
        description: updateFailureMessage(error),
      });
    } finally {
      pendingUpdateEnvironmentIds.delete(environmentId);
    }
  };
  return (
    <Button size="xs" variant="outline" onClick={() => void handleUpdate()}>
      {label ?? t("connections.update")}
    </Button>
  );
}
