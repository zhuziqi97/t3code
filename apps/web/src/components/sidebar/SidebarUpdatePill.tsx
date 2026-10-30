import type { DesktopBridge, DesktopUpdateState } from "@t3tools/contracts";
import { TriangleAlertIcon } from "lucide-react";
import { type ComponentProps, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslate } from "../../i18n";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { isElectron } from "../../env";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/utils";
import { ensureLocalApi } from "../../localApi";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateDownloadedVersion,
  getDesktopUpdateIdleTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldToastDesktopUpdateActionResult,
} from "../desktopUpdate.logic";
import {
  openDesktopUpdateDownload,
  showDesktopUpdateDownloadedToast,
  showDesktopUpdateErrorToast,
} from "../desktopUpdate.toast";
import { Button } from "../ui/button";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Popover, PopoverCreateHandle, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  DesktopUpdateStatusIcon,
  shouldContinueDesktopUpdateCheckAnimation,
  shouldShowDesktopUpdateCheckIcon,
} from "./DesktopUpdateStatusIcon";
import { SidebarUpdateReleaseNotes } from "./SidebarUpdateReleaseNotes";
import { SidebarUpdateCapsule } from "./SidebarUpdateCapsule";
import { UpdateEverythingDialog } from "./UpdateEverythingDialog";
import {
  resolveSidebarUpdateActions,
  resolveSidebarUpdatePresentation,
  type UpdateRunLocalState,
} from "./updateEverything.logic";
import {
  clearSavedUpdateEverythingResult,
  saveUpdateEverythingResult,
  useUpdateEverythingRun,
} from "./updateEverythingRun";
import { type ReportLocalUpdateError, useUpdateEverything } from "./useUpdateEverything";

type SidebarUpdatePopoverChangeDetails = Parameters<
  NonNullable<ComponentProps<typeof Popover>["onOpenChange"]>
>[1];
type SidebarUpdatePopoverHandle = ReturnType<typeof PopoverCreateHandle>;

function shouldUseSidebarUpdateReleaseNotesPopover(
  showUpdateDetails: boolean,
  state: DesktopUpdateState | null,
): boolean {
  return showUpdateDetails && (state?.releaseNotes.length ?? 0) > 0;
}

function handleSidebarUpdateReleaseNotesPopoverOpenChange(
  _open: boolean,
  details: Pick<SidebarUpdatePopoverChangeDetails, "reason" | "cancel">,
): void {
  if (details.reason === "trigger-press") details.cancel();
}

function openSidebarUpdateReleaseNotesPopoverOnForwardTab(
  event: { readonly key: string; readonly shiftKey: boolean },
  handle: Pick<SidebarUpdatePopoverHandle, "open">,
  triggerId: string,
): void {
  if (event.key !== "Tab" || event.shiftKey) return;
  // Hover-open popovers do not manage focus. Promote this one before native Tab runs.
  flushSync(() => handle.open(triggerId));
}

export function SidebarUpdateArchitectureWarning() {
  return isElectron ? <SidebarUpdateArchitectureWarningContent /> : null;
}

function SidebarUpdateArchitectureWarningContent() {
  const t = useTranslate();
  const state = useDesktopUpdateState();
  const visible = shouldShowArm64IntelBuildWarning(state);
  const description = state && visible ? getArm64IntelBuildWarningDescription(state, t) : null;

  if (!visible || !description) return null;

  return (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertTitle>{t("update.architecture.title")}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}

const toastUpdateError: ReportLocalUpdateError = (title, description) => {
  showDesktopUpdateErrorToast(title, description, "update.unexpected");
};

export async function downloadLocalUpdate(
  bridge: DesktopBridge,
  {
    notifyDownloaded,
    reportError = toastUpdateError,
  }: { readonly notifyDownloaded: boolean; readonly reportError?: ReportLocalUpdateError },
): Promise<boolean> {
  try {
    const result = await bridge.downloadUpdate();
    if (result.completed && notifyDownloaded) {
      showDesktopUpdateDownloadedToast(bridge, result.state);
    }
    const actionError = shouldToastDesktopUpdateActionResult(result)
      ? getDesktopUpdateActionError(result)
      : null;
    if (actionError) reportError("about.updateDownload.error", actionError);
    return result.completed;
  } catch (error) {
    reportError(
      "update.downloadStartFailed",
      error instanceof Error ? error.message : "An unexpected error occurred.",
    );
    return false;
  }
}

export async function installLocalUpdate(
  bridge: DesktopBridge,
  reportError: ReportLocalUpdateError = toastUpdateError,
  expectedVersion?: string,
): Promise<boolean> {
  try {
    const result = await bridge.installUpdate(expectedVersion);
    if (!result.accepted) {
      showDesktopUpdateDownloadedToast(bridge, result.state);
      return false;
    }
    const actionError = shouldToastDesktopUpdateActionResult(result)
      ? getDesktopUpdateActionError(result)
      : null;
    if (!actionError) return true;
    reportError("about.updateInstall.error", actionError);
    return false;
  } catch (error) {
    reportError(
      "about.updateInstall.error",
      error instanceof Error ? error.message : "An unexpected error occurred.",
    );
    return false;
  }
}

export function SidebarUpdatePill() {
  return <SidebarUpdateControl />;
}

function SidebarUpdateControl() {
  const t = useTranslate();
  const state = useDesktopUpdateState();
  const [isActionPending, setIsActionPending] = useState(false);
  const [isClientDownloadPending, setIsClientDownloadPending] = useState(false);
  const [isConfirmingEverything, setIsConfirmingEverything] = useState(false);
  const [checkAnimationKey, setCheckAnimationKey] = useState(0);
  const [updatePopoverHandle] = useState(() => PopoverCreateHandle());
  const suppressUpdateFocusOpen = useRef(false);
  const updatePopupRef = useRef<HTMLDivElement>(null);
  const updateTriggerId = useId();
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  const updateStatus = state?.status;
  const [isCheckAnimationLatched, setIsCheckAnimationLatched] = useState(
    () => !prefersReducedMotion && updateStatus === "checking",
  );
  const [latchInputs, setLatchInputs] = useState({ prefersReducedMotion, updateStatus });
  if (
    latchInputs.prefersReducedMotion !== prefersReducedMotion ||
    latchInputs.updateStatus !== updateStatus
  ) {
    setLatchInputs({ prefersReducedMotion, updateStatus });
    if (prefersReducedMotion) {
      setIsCheckAnimationLatched(false);
    } else if (updateStatus === "checking") {
      setIsCheckAnimationLatched(true);
    }
  }

  const localAction = state && !state.convene ? resolveDesktopUpdateButtonAction(state) : "none";
  const isDownloading = state?.status === "downloading";
  const localUpdateVersion =
    state && localAction !== "none" ? getDesktopUpdateDownloadedVersion(state) : null;
  const everything = useUpdateEverything(localUpdateVersion);
  const { runsEverything } = resolveSidebarUpdateActions(state, everything.hasUpdates);
  const run = useUpdateEverythingRun();
  const isRunningEverything = run !== null;
  const showCheckIcon = shouldShowDesktopUpdateCheckIcon({
    isAnimationLatched: isCheckAnimationLatched,
    isChecking: state?.status === "checking",
    prefersReducedMotion,
  });
  const {
    action,
    showClientDownload,
    iconStatus,
    showUpdateDetails,
    showUpdateIconState,
    disabled,
    isInteractionDisabled,
  } = resolveSidebarUpdatePresentation({
    state,
    showsEverything: runsEverything,
    run,
    isDownloading,
    showCheckIcon,
    isActionPending,
    isClientDownloadPending,
  });
  const idleTooltip =
    !showUpdateDetails && !showCheckIcon ? getDesktopUpdateIdleTooltip(state, t) : null;
  const clientLabel =
    showClientDownload && state
      ? t(
          state.convene?.relation === "different-build"
            ? "update.client.revision"
            : "update.client.available",
          {
            version: state.availableVersion,
          },
        )
      : null;
  const tooltip = clientLabel
    ? [clientLabel, runsEverything ? everything.summary : null].filter(Boolean).join("\n")
    : runsEverything
      ? everything.summary
      : showUpdateDetails
        ? state
          ? getDesktopUpdateButtonTooltip(state, t)
          : t("update.availableShort")
        : showCheckIcon
          ? t("update.checking")
          : (idleTooltip?.title ?? t("update.check"));
  const showUpdatePopover =
    showClientDownload ||
    (!isRunningEverything && shouldUseSidebarUpdateReleaseNotesPopover(showUpdateDetails, state));

  const [updatePopoverOpen, setUpdatePopoverOpen] = useState(false);
  const [updateTriggerFocusVisible, setUpdateTriggerFocusVisible] = useState(false);
  const [updatePopoverShownBefore, setUpdatePopoverShownBefore] = useState(showUpdatePopover);
  if (updatePopoverShownBefore !== showUpdatePopover) {
    setUpdatePopoverShownBefore(showUpdatePopover);
    setUpdatePopoverOpen(showUpdatePopover && updateTriggerFocusVisible);
  }

  const handleAction = async () => {
    const bridge = window.desktopBridge;
    if (isInteractionDisabled || showClientDownload) return;

    if (runsEverything) {
      setIsConfirmingEverything(true);
      return;
    }

    if (!bridge || !state) return;
    setIsActionPending(true);

    if (action === "download") {
      void downloadLocalUpdate(bridge, { notifyDownloaded: true }).finally(() =>
        setIsActionPending(false),
      );
      return;
    }

    if (action === "install") {
      let confirmed = false;
      try {
        confirmed = await ensureLocalApi().dialogs.confirm(
          getDesktopUpdateInstallConfirmationMessage(state, t),
        );
      } catch (error) {
        setIsActionPending(false);
        showDesktopUpdateErrorToast(
          "about.updateConfirm.error",
          error instanceof Error ? error.message : null,
          "about.updateConfirm.failed",
        );
        return;
      }
      if (!confirmed) {
        setIsActionPending(false);
        return;
      }
      void installLocalUpdate(bridge).finally(() => setIsActionPending(false));
      return;
    }

    if (!prefersReducedMotion) {
      setIsCheckAnimationLatched(true);
      setCheckAnimationKey((key) => key + 1);
    }
    void bridge
      .checkForUpdate()
      .then((result) => {
        if (result.checked) return;
        showDesktopUpdateErrorToast(
          "about.updateCheck.error",
          result.state.message,
          "about.updateUnsupported",
        );
      })
      .catch((error) => {
        showDesktopUpdateErrorToast(
          "about.updateCheck.error",
          error instanceof Error ? error.message : null,
          "about.updateCheck.failed",
        );
      })
      .finally(() => setIsActionPending(false));
  };

  const runEverything = async () => {
    const bridge = window.desktopBridge;
    setIsConfirmingEverything(false);
    setIsActionPending(true);
    const result = await settlePromise(() =>
      everything.run({
        ...(bridge && action === "download"
          ? {
              downloadLocal: (reportError) =>
                downloadLocalUpdate(bridge, { notifyDownloaded: false, reportError }),
            }
          : {}),
        ...(bridge && (action === "download" || action === "install")
          ? { installLocal: (reportError) => installLocalUpdate(bridge, reportError) }
          : {}),
      }),
    );
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("update.everything.couldNotUpdate"),
          description: error instanceof Error ? error.message : t("common.unexpectedError"),
        }),
      );
    }
    setIsActionPending(false);
  };

  const handleCheckAnimationIteration = () => {
    setIsCheckAnimationLatched(
      shouldContinueDesktopUpdateCheckAnimation({
        isChecking: state?.status === "checking",
        prefersReducedMotion,
      }),
    );
  };

  if (!isElectron && !runsEverything && !isRunningEverything) return null;

  const statusIcon = (
    <DesktopUpdateStatusIcon
      key={showCheckIcon ? checkAnimationKey : iconStatus}
      downloadPercent={state?.downloadPercent ?? null}
      isCheckAnimating={showCheckIcon && !prefersReducedMotion}
      onCheckAnimationIteration={handleCheckAnimationIteration}
      status={iconStatus}
    />
  );
  const confirmDialog = (
    <UpdateEverythingDialog
      open={isConfirmingEverything}
      onOpenChange={setIsConfirmingEverything}
      version={everything.version}
      providerCount={everything.providerCount}
      rows={everything.rows}
      restarts={everything.restarts}
      onConfirm={() => void runEverything()}
    />
  );

  const local: UpdateRunLocalState =
    !run || run.localVersion === null
      ? null
      : state?.status === "downloading"
        ? { status: "downloading", percent: state.downloadPercent }
        : { status: "waiting" };
  const runCapsule = run ? (
    <SidebarUpdateCapsule
      run={run}
      local={local}
      icon={statusIcon}
      {...(run.localVersion === null && action === "install" && window.desktopBridge
        ? {
            onRestart: async () => {
              saveUpdateEverythingResult({
                localVersion: localUpdateVersion,
                updatedServers: 0,
                updatedProviders: 0,
                failures: [],
                restarting: [],
              });
              if (!(await installLocalUpdate(window.desktopBridge!))) {
                clearSavedUpdateEverythingResult();
              }
            },
          }
        : {})}
    />
  ) : null;

  const updateButton = (
    <button
      type="button"
      aria-label={idleTooltip?.detail ? `${tooltip}: ${idleTooltip.detail}` : tooltip}
      aria-disabled={isInteractionDisabled || undefined}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full outline-hidden ring-ring transition-colors focus-visible:ring-2 focus-visible:ring-inset",
        run && "ml-2",
        isInteractionDisabled ? "cursor-not-allowed" : "cursor-pointer",
        showUpdateIconState
          ? cn(
              "bg-sidebar-control-surface text-sidebar-foreground",
              !isInteractionDisabled && "hover:bg-sidebar-row-hover",
            )
          : cn(
              "text-(--sidebar-icon-color)",
              !isInteractionDisabled && "hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
            ),
        disabled && !showUpdateIconState && "opacity-60",
      )}
      onClick={handleAction}
      onBlur={() => {
        suppressUpdateFocusOpen.current = false;
        setUpdateTriggerFocusVisible(false);
      }}
      onFocus={(event) => {
        const focusVisible = event.currentTarget.matches(":focus-visible");
        setUpdateTriggerFocusVisible(focusVisible);
        if (!showUpdatePopover || showClientDownload || !focusVisible) return;
        if (suppressUpdateFocusOpen.current) {
          suppressUpdateFocusOpen.current = false;
          return;
        }
        flushSync(() => updatePopoverHandle.open(updateTriggerId));
      }}
      onKeyDown={(event) => {
        if (!showUpdatePopover) return;
        openSidebarUpdateReleaseNotesPopoverOnForwardTab(
          event,
          updatePopoverHandle,
          updateTriggerId,
        );
      }}
    >
      {statusIcon}
    </button>
  );

  return (
    <SidebarMenuItem
      className={run ? "ml-auto flex min-w-0 flex-1 items-center" : "ml-auto shrink-0"}
    >
      {runCapsule}
      {!run || showClientDownload ? (
        <Popover
          handle={updatePopoverHandle}
          open={updatePopoverOpen && showUpdatePopover}
          triggerId={updateTriggerId}
          onOpenChange={(open, details) => {
            if (open && !showUpdatePopover) {
              details.cancel();
              return;
            }
            if (!showClientDownload)
              handleSidebarUpdateReleaseNotesPopoverOpenChange(open, details);
            if (!details.isCanceled) setUpdatePopoverOpen(open);
          }}
        >
          <Tooltip disabled={showUpdatePopover}>
            <TooltipTrigger
              id={updateTriggerId}
              render={
                <PopoverTrigger
                  {...(!showUpdatePopover
                    ? {
                        "aria-controls": undefined,
                        "aria-expanded": undefined,
                        "aria-haspopup": undefined,
                      }
                    : {})}
                  closeDelay={150}
                  handle={updatePopoverHandle}
                  id={updateTriggerId}
                  openOnHover={showUpdatePopover}
                  render={updateButton}
                />
              }
            />
            {!showUpdatePopover ? (
              <TooltipPopup
                align="center"
                side="top"
                variant={showUpdateDetails ? "glass" : "default"}
              >
                {idleTooltip?.detail ? (
                  <div className="text-left">
                    <div className="font-medium">{idleTooltip.title}</div>
                    <div className="text-muted-foreground">{idleTooltip.detail}</div>
                  </div>
                ) : (
                  <span className="whitespace-pre-line">{tooltip}</span>
                )}
              </TooltipPopup>
            ) : null}
          </Tooltip>
          {showUpdatePopover && state ? (
            <PopoverPopup
              align="center"
              aria-label={clientLabel ?? t("update.notes.title")}
              initialFocus={false}
              onKeyDownCapture={(event) => {
                if (
                  event.key === "Escape" &&
                  updatePopupRef.current?.contains(document.activeElement)
                ) {
                  suppressUpdateFocusOpen.current = true;
                }
              }}
              ref={updatePopupRef}
              side="top"
              tooltipStyle
            >
              {showClientDownload ? (
                <div className="flex w-64 max-w-[calc(100vw-2rem)] min-w-0 flex-col gap-2 text-left">
                  <p className="text-sm font-medium wrap-break-word">{clientLabel}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      state.convene?.downloadUrl
                        ? "update.platform.manualInstall"
                        : "update.platform.noPackage",
                    )}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isClientDownloadPending}
                    onClick={() => {
                      const bridge = window.desktopBridge;
                      if (!bridge || isClientDownloadPending) return;
                      setIsClientDownloadPending(true);
                      void openDesktopUpdateDownload(bridge).finally(() =>
                        setIsClientDownloadPending(false),
                      );
                    }}
                  >
                    {t(
                      state.convene?.downloadUrl
                        ? "update.platform.download"
                        : "update.platform.downloads",
                    )}
                  </Button>
                  {runsEverything && !isRunningEverything ? (
                    <Button
                      size="sm-multiline"
                      variant="outline"
                      disabled={isActionPending}
                      onClick={() => {
                        setUpdatePopoverOpen(false);
                        setIsConfirmingEverything(true);
                      }}
                    >
                      {everything.summary}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <SidebarUpdateReleaseNotes
                  shell={window.desktopBridge}
                  state={state}
                  tooltip={tooltip}
                />
              )}
            </PopoverPopup>
          ) : null}
        </Popover>
      ) : null}
      {confirmDialog}
    </SidebarMenuItem>
  );
}
