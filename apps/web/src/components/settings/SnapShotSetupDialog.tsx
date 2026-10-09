import { useTranslate } from "../../i18n";
import { formatSnapShotMessage } from "./snapShotMessages";
import { PermissionChecklist, PermissionContinueButton } from "../permissions/PermissionChecklist";
import { usePermissionStatus } from "../permissions/usePermissionStatus";
import {
  isModifierPairShortcut,
  type DesktopSnapShotSetupAction,
  type DesktopSnapShotState,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { MacAccessibilityIcon, MacScreenRecordingIcon } from "../Icons";
import { CaptureShortcutConfig } from "./CaptureShortcutConfig";
import { Button } from "../ui/button";
import { Dialog, DialogDescription } from "../ui/dialog";
import { WizardSteps, WizardPopup, WizardHeader, WizardPanel, WizardFooter } from "../ui/wizard";
import {
  captureSetupAccessReady,
  captureSetupBackend,
  captureSetupCheckMessage,
  captureSetupDesktopName,
  captureSetupInitialStep,
  captureSetupShortcutReady,
  type CaptureSetupStep,
} from "./SnapShotSetupDialog.logic";

const SETUP_STEPS = [
  { id: "access", label: "snapshots.setup.access" },
  { id: "shortcut", label: "snapshots.shortcut" },
] as const;

const GNOME_ACCESS_COPY = {
  "not-installed": {
    title: "snapshots.gnome.install-title",
    description: "snapshots.gnome.install-description",
  },
  "restart-required": {
    title: "snapshots.gnome.installed",
    description: "snapshots.gnome.login-description",
  },
  "update-required": {
    title: "snapshots.gnome.update",
    description: "snapshots.gnome.update-description",
  },
  "extensions-disabled": {
    title: "snapshots.gnome.allow",
    description: "snapshots.gnome.allow-description",
  },
  disabled: {
    title: "snapshots.gnome.enable",
    description: "snapshots.gnome.enable-description",
  },
  enabled: {
    title: "snapshots.setup.ready",
    description: "snapshots.setup.next",
  },
  unsupported: {
    title: "snapshots.setup.no-auto",
    description: "snapshots.setup.palette-picker",
  },
  error: {
    title: "snapshots.gnome.failed",
    description: "snapshots.gnome.failed-description",
  },
} as const;

export function SnapShotSetupDialog({
  state,
  initialStep,
  wasEnabled,
  includeAccessibility,
  busy: actionBusy,
  error,
  shortcutInput,
  shortcutStatus,
  shortcutChanged,
  canSaveShortcut,
  onSaveShortcut,
  onEnable,
  onAction,
  onRefresh,
  onClose,
  onLeaveStep,
}: {
  state: DesktopSnapShotState;
  initialStep: CaptureSetupStep;
  wasEnabled: boolean;
  includeAccessibility: boolean;
  busy: boolean;
  error: string | null;
  shortcutInput: ReactNode;
  shortcutStatus: string | null | undefined;
  shortcutChanged: boolean;
  canSaveShortcut: boolean;
  onSaveShortcut: () => Promise<boolean>;
  onEnable: () => Promise<boolean>;
  onAction: (action: DesktopSnapShotSetupAction) => Promise<void>;
  onRefresh: () => Promise<DesktopSnapShotState | undefined>;
  onClose: (completed: boolean) => Promise<void>;
  onLeaveStep: () => void;
}) {
  const t = useTranslate();
  const [step, setStep] = useState(() => captureSetupInitialStep(state, initialStep));
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const busy = actionBusy || checking || configBusy;
  const backend = captureSetupBackend(state);
  const configShortcut = backend === "niri" || backend === "hyprland";
  const desktop = captureSetupDesktopName(state);
  const extension = state.gnomeExtension;
  const helper = backend === "hyprland" ? state.hyprlandHelper : state.kdeHelper;
  const helperBackend = backend === "kde" || backend === "hyprland";
  const installHelper = backend === "hyprland" ? "install-hyprland-helper" : "install-kde-helper";
  const removeHelper = backend === "hyprland" ? "remove-hyprland-helper" : "remove-kde-helper";
  const accessReady = captureSetupAccessReady(state);
  const permissionStatus = usePermissionStatus(
    async () => {
      const refreshed = await onRefresh();
      if (!refreshed?.macPermissions) throw new Error("Permission status unavailable");
      return refreshed.macPermissions;
    },
    state.macPermissions ?? { screenRecording: false, accessibility: false },
    Boolean(state.macPermissions) && step === "access" && !busy,
  );
  const macPermissions = state.macPermissions ? permissionStatus.status : undefined;
  const macPermissionsReady =
    !macPermissions ||
    permissionStatus.isReady(
      includeAccessibility ? ["screenRecording", "accessibility"] : ["screenRecording"],
    );
  const shortcutReady = captureSetupShortcutReady(state, shortcutChanged);
  const install = extension?.status === "not-installed" || extension?.status === "update-required";
  const enable = extension?.status === "disabled";
  const changeStep = (next: CaptureSetupStep) => {
    onLeaveStep();
    setChecked(false);
    setStep(next);
  };
  const checkAgain = async () => {
    if (busy) return;
    setChecking(true);
    setChecked(false);
    try {
      setChecked((await onRefresh()) !== undefined);
    } finally {
      setChecking(false);
    }
  };
  const accessCopy =
    state.message && !macPermissions
      ? {
          title: t("snapshots.setup.retry-title"),
          description: t("snapshots.setup.retry-description"),
        }
      : backend === "gnome" && extension
        ? extension.status === "enabled" && !accessReady
          ? {
              title: t("snapshots.setup.check-title"),
              description: t("snapshots.setup.extension-not-ready"),
            }
          : {
              title: t(GNOME_ACCESS_COPY[extension.status].title),
              description: t(GNOME_ACCESS_COPY[extension.status].description),
            }
        : helperBackend
          ? helper?.status === "ready"
            ? {
                title: t("snapshots.setup.ready"),
                description: t("snapshots.setup.next"),
              }
            : helper?.status === "error"
              ? {
                  title: t("snapshots.setup.fix-access"),
                  description: t("snapshots.setup.reinstall-description"),
                }
              : {
                  title:
                    helper?.status === "update-required"
                      ? t("snapshots.setup.update-helper-title")
                      : t("snapshots.setup.allow-title"),
                  description: t("snapshots.setup.helper-description"),
                }
          : backend === "niri"
            ? {
                title: t("snapshots.setup.ready"),
                description: t("snapshots.setup.next"),
              }
            : backend === "picker"
              ? {
                  title: t("snapshots.setup.picker-title"),
                  description: t("snapshots.setup.picker-description"),
                }
              : {
                  title: t("snapshots.setup.allow-title"),
                  description:
                    backend === "portal"
                      ? t("snapshots.setup.portal-description")
                      : macPermissions
                        ? macPermissionsReady
                          ? t("snapshots.setup.mac-test")
                          : t("snapshots.setup.permissions-description")
                        : t("snapshots.setup.direct-description"),
                };
  const title = step === "access" ? accessCopy.title : t("snapshots.setup.choose-title");
  const description =
    step === "access"
      ? accessCopy.description
      : configShortcut
        ? t("snapshots.setup.config-keys")
        : state.mode === "portal"
          ? t("snapshots.setup.portal-keys")
          : t("snapshots.setup.direct-keys");
  const stepIndex = SETUP_STEPS.findIndex(({ id }) => id === step);
  const details = [
    ...new Set(
      [
        error,
        ...(step === "access"
          ? [
              state.message,
              backend === "gnome" &&
              (extension?.status === "error" || extension?.status === "unsupported")
                ? extension.message
                : null,
              helperBackend && helper?.status === "error" ? helper.message : null,
            ]
          : []),
      ].filter((detail) => detail !== null),
    ),
  ];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) void onClose(false);
      }}
    >
      <WizardPopup showCloseButton={!busy}>
        <WizardHeader
          title={
            desktop ? t("snapshots.setup.desktop-title", { desktop }) : t("snapshots.setup.title")
          }
        >
          <WizardSteps
            steps={SETUP_STEPS.map((item) => t(item.label))}
            currentStep={stepIndex}
            isStepDisabled={(index) => busy || index > stepIndex}
            onStepChange={(index) => {
              const next = SETUP_STEPS[index];
              if (next && next.id !== step) changeStep(next.id);
            }}
          />
        </WizardHeader>
        <WizardPanel>
          <div className="space-y-4 text-sm">
            <div className="space-y-2" aria-live="polite">
              <h3 className="flex items-center gap-2 font-medium">{title}</h3>
              <DialogDescription>{description}</DialogDescription>
            </div>
            {step === "access" ? (
              <>
                <p
                  role="status"
                  aria-atomic="true"
                  className={
                    checked && !busy && !error ? "text-xs text-muted-foreground" : "sr-only"
                  }
                >
                  {checked && !busy && !error ? captureSetupCheckMessage(state, t) : null}
                </p>
                {macPermissions ? (
                  <PermissionChecklist
                    busy={busy}
                    permissions={[
                      {
                        id: "screenRecording",
                        icon: <MacScreenRecordingIcon className="size-8 shrink-0 drop-shadow-sm" />,
                        title: t("snapshots.permission.screen"),
                        description: t("snapshots.permission.screen-description"),
                        granted: macPermissions.screenRecording,
                        onAllow: () => void onAction("allow-screen-recording"),
                      },
                      {
                        id: "accessibility",
                        icon: <MacAccessibilityIcon className="size-8 shrink-0 drop-shadow-sm" />,
                        title: t("snapshots.permission.accessibility"),
                        description: includeAccessibility
                          ? t("snapshots.permission.text")
                          : t("snapshots.permission.text-optional"),
                        granted: macPermissions.accessibility,
                        onAllow: () => void onAction("allow-accessibility"),
                      },
                    ]}
                  />
                ) : null}
                {permissionStatus.error && macPermissions ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    {permissionStatus.error}
                  </p>
                ) : null}
                {helperBackend && helper?.status === "error" ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void onAction(installHelper)}
                  >
                    {t("snapshots.setup.reinstall")}
                  </Button>
                ) : null}
              </>
            ) : configShortcut ? (
              <CaptureShortcutConfig
                state={state}
                disabled={actionBusy || checking || !accessReady}
                onBusyChange={setConfigBusy}
                onSaved={onRefresh}
                onComplete={() => onClose(true)}
              />
            ) : (
              <div className="space-y-3">
                {shortcutInput}
                {shortcutStatus ? (
                  <p className="text-xs text-muted-foreground" role="status">
                    {shortcutStatus}
                  </p>
                ) : null}
                {!shortcutChanged &&
                !state.shortcutRegistered &&
                !state.shortcutPending &&
                state.shortcutCanRetry !== false &&
                !isModifierPairShortcut(state.shortcut) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void onAction("retry-shortcut")}
                  >
                    {state.mode === "portal"
                      ? t("snapshots.shortcut.permissions")
                      : t("snapshots.try-again")}
                  </Button>
                ) : null}
              </div>
            )}
            {step === "shortcut" && !accessReady ? (
              <p role="alert" className="text-destructive">
                {t("snapshots.setup.access-attention")}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-destructive">
                {t("snapshots.setup.step-failed")}
              </p>
            ) : null}
            {details.length > 0 || (step === "access" && (backend === "gnome" || helperBackend)) ? (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{t("snapshots.advanced")}</summary>
                <div className="mt-3 space-y-3">
                  {details.map((detail) => (
                    <p key={detail} className="break-words">
                      {detail ? formatSnapShotMessage(detail, t) : detail}
                    </p>
                  ))}
                  {step === "access" && (backend === "gnome" || helperBackend) ? (
                    <p>{t("snapshots.setup.included")}</p>
                  ) : null}
                  {step === "access" && backend === "gnome" && extension?.status === "enabled" ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void onAction("disable-extension")}
                    >
                      {t("snapshots.setup.disable-extension")}
                    </Button>
                  ) : null}
                  {step === "access" && helperBackend && helper?.status !== "not-installed" ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void onAction(removeHelper)}
                    >
                      {t("snapshots.setup.remove-helper")}
                    </Button>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
        </WizardPanel>
        <WizardFooter>
          {step !== "access" ? (
            <Button variant="ghost" disabled={busy} onClick={() => changeStep("access")}>
              {t("snapshots.back")}
            </Button>
          ) : null}
          <Button variant="ghost" disabled={busy} onClick={() => void onClose(false)}>
            {wasEnabled ? t("snapshots.close") : t("snapshots.later")}
          </Button>
          {step === "access" ? (
            helperBackend && !accessReady && helper?.status !== "ready" ? (
              <Button
                disabled={busy}
                aria-busy={busy}
                onClick={() =>
                  void (helper?.status === "error" ? checkAgain() : onAction(installHelper))
                }
              >
                {checking
                  ? t("snapshots.checking")
                  : busy
                    ? t("snapshots.installing")
                    : helper?.status === "error"
                      ? t("snapshots.check-again")
                      : helper?.status === "update-required"
                        ? t("snapshots.setup.update-helper")
                        : t("snapshots.setup.install-helper")}
              </Button>
            ) : backend === "gnome" && !accessReady && extension?.status !== "enabled" ? (
              <Button
                disabled={busy}
                aria-busy={checking}
                onClick={() =>
                  void (install
                    ? onAction("install-extension")
                    : enable
                      ? onAction("enable-extension")
                      : checkAgain())
                }
              >
                {checking
                  ? t("snapshots.checking")
                  : busy
                    ? install
                      ? t("snapshots.installing")
                      : enable
                        ? t("snapshots.enabling")
                        : t("snapshots.working")
                    : install
                      ? extension?.status === "update-required"
                        ? t("snapshots.setup.update-extension")
                        : t("snapshots.setup.install-extension")
                      : enable
                        ? t("snapshots.setup.enable-extension")
                        : t("snapshots.check-again")}
              </Button>
            ) : (
              <PermissionContinueButton
                ready={macPermissionsReady}
                busy={busy}
                onClick={async () => {
                  if (await onEnable()) changeStep("shortcut");
                }}
              >
                {busy
                  ? t("snapshots.working")
                  : macPermissions
                    ? t("snapshots.setup.test-continue")
                    : backend === "direct"
                      ? t("snapshots.setup.allow-capture")
                      : !accessReady && !macPermissions
                        ? t("snapshots.try-again")
                        : t("snapshots.continue")}
              </PermissionContinueButton>
            )
          ) : !configShortcut ? (
            <Button
              disabled={
                busy || !accessReady || (shortcutChanged ? !canSaveShortcut : !shortcutReady)
              }
              onClick={async () => {
                if (!shortcutChanged || (await onSaveShortcut())) await onClose(true);
              }}
            >
              {busy
                ? t("snapshots.saving")
                : shortcutChanged
                  ? t("snapshots.setup.save-finish")
                  : t("snapshots.done")}
            </Button>
          ) : null}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
