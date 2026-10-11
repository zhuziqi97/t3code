import { i18n, useTranslate } from "../../i18n";
import type { TFunction } from "i18next";
import type { MessageKey } from "@t3tools/client-runtime/i18n";
import { PermissionChecklist, PermissionContinueButton } from "../permissions/PermissionChecklist";
import { usePermissionStatus } from "../permissions/usePermissionStatus";
import type { BrowserImportSource } from "@t3tools/contracts";
import { BROWSER_IMPORT_FAILURE_COPY } from "@t3tools/contracts";
import { ArrowDownIcon, ArrowRightIcon, CheckIcon, HardDriveIcon } from "lucide-react";
import { useRef, useState } from "react";

import { cn, randomUUID } from "~/lib/utils";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import {
  initialWizardStep,
  browserProfileDisplayName,
  initialTargetSelection,
  canCloseWizard,
  isRetryableReason,
  formatSkippedDomains,
  fullDiskAccessRecheckStep,
  outcomeToStep,
  refreshedSourceProfileDirectory,
  refreshedSourceStep,
  resolveWizardTarget,
  type ImportOutcome,
  type WizardTarget,
  type WizardTargetProfile,
  type WizardTargetSelection,
  type WizardStep,
} from "./browserImportWizard.logic";

export type { WizardTarget } from "./browserImportWizard.logic";

interface BrowserImportWizardProps {
  readonly source: BrowserImportSource;
  /** Captured when the wizard opens so destination copy and writes stay stable. */
  readonly destinationEnvironmentName: string;
  /** Existing profiles the import can go into. Incognito is excluded upstream. */
  readonly targetProfiles: ReadonlyArray<WizardTargetProfile>;
  /** Whether a new profile can still be created (profile cap). */
  readonly canCreateProfile: boolean;
  /**
   * Runs the import and returns how it went. For a new target the caller only
   * registers the profile once the import succeeds, so a blocked attempt never
   * leaves an empty profile behind.
   */
  readonly onImport: (input: {
    readonly sourceProfileDirectory: string;
    readonly target: WizardTarget;
  }) => Promise<ImportOutcome>;
  /** Re-checks the source's availability after the user quits the browser. */
  readonly onRefreshSource: () => Promise<BrowserImportSource | undefined>;
  /** Opens the OS setting that grants access to a protected cookie store. */
  readonly onOpenFullDiskAccessSettings: () => void | Promise<void>;
  readonly onCheckFullDiskAccess?: (() => Promise<boolean>) | undefined;
  readonly onClose: () => void;
}

/**
 * Guides one browser's cookies into a profile.
 *
 * Every state the import can be in — the browser is open, a profile has to be
 * chosen, the read failed — is a screen the user can move forward from, rather
 * than a disabled row that only says no.
 */
export function BrowserImportWizard({
  source: initialSource,
  destinationEnvironmentName,
  targetProfiles,
  canCreateProfile,
  onImport,
  onRefreshSource,
  onOpenFullDiskAccessSettings,
  onCheckFullDiskAccess,
  onClose,
}: BrowserImportWizardProps) {
  const t = useTranslate();
  const [source, setSource] = useState(initialSource);
  const [step, setStep] = useState<WizardStep>(() => initialWizardStep(initialSource));
  const [sourceProfileDirectory, setSourceProfileDirectory] = useState(
    () => initialSource.profiles[0]?.directory ?? "",
  );
  const [target, setTarget] = useState<WizardTargetSelection>(() =>
    initialTargetSelection(canCreateProfile, targetProfiles),
  );
  const [targetError, setTargetError] = useState<MessageKey>();
  // Stable across retries so a keychain re-approval lands in one profile, not
  // a new one each time.
  const newProfileId = useRef(`profile-${randomUUID()}`);
  // A second Import click before React has left the configure screen would
  // start a second run; the parent refuses it, and applying that refusal here
  // would drop the wizard out of the importing step while the first write is
  // still going. The ref settles synchronously where state does not.
  const importInFlight = useRef(false);

  const runImport = () => {
    if (importInFlight.current) return;
    const chosen = resolveWizardTarget(target, newProfileId.current, targetProfiles);
    if (chosen === undefined) {
      setTargetError("integrations.import.target-missing");
      setStep({ step: "configure" });
      return;
    }
    setTargetError(undefined);
    importInFlight.current = true;
    setStep({ step: "importing" });
    void onImport({ sourceProfileDirectory, target: chosen })
      .then((outcome) => setStep(outcomeToStep(outcome)))
      .catch(() => setStep({ step: "blocked", reason: "readFailed" }))
      .finally(() => {
        importInFlight.current = false;
      });
  };

  // Re-lists the source after the user did something outside the app (quit the
  // browser, granted access) and routes to wherever the refreshed source says.
  const recheckSource = (
    check: "browser" | "fullDiskAccess",
    nextStep: (refreshed: BrowserImportSource | undefined) => WizardStep,
  ) => {
    setStep({ step: "checking", check });
    void onRefreshSource()
      .then((refreshed) => {
        if (refreshed) {
          setSource(refreshed);
          setSourceProfileDirectory((current) =>
            refreshedSourceProfileDirectory(current, refreshed),
          );
        }
        setStep(nextStep(refreshed));
      })
      .catch(() => setStep({ step: "blocked", reason: "readFailed" }));
  };
  const recheckAfterQuit = () => recheckSource("browser", refreshedSourceStep);
  const recheckFullDiskAccess = () => recheckSource("fullDiskAccess", fullDiskAccessRecheckStep);

  return (
    <Dialog open onOpenChange={(open) => (open || !canCloseWizard(step) ? undefined : onClose())}>
      <DialogPopup className="max-w-lg" showCloseButton={canCloseWizard(step)}>
        {step.step === "quit" ? (
          <QuitStep source={source} onCancel={onClose} onRechecked={recheckAfterQuit} />
        ) : step.step === "fullDiskAccess" ? (
          <FullDiskAccessStep
            source={source}
            onCancel={onClose}
            onOpenSettings={onOpenFullDiskAccessSettings}
            onCheck={
              onCheckFullDiskAccess ??
              (async () => {
                const refreshed = await onRefreshSource();
                return refreshed !== undefined && refreshed.unavailable === undefined;
              })
            }
            onGranted={step.resume === "import" ? runImport : recheckFullDiskAccess}
            stillRequired={step.checked === true}
          />
        ) : step.step === "importing" ? (
          <ImportingStep />
        ) : step.step === "checking" ? (
          <CheckingStep sourceName={source.name} check={step.check} />
        ) : step.step === "done" ? (
          <DoneStep
            {...step}
            targetName={
              target.kind === "existing"
                ? browserProfileDisplayName({ id: target.profileId, name: step.targetName }, t)
                : step.targetName
            }
            destinationEnvironmentName={destinationEnvironmentName}
            onClose={onClose}
          />
        ) : step.step === "blocked" ? (
          <BlockedStep
            source={source}
            reason={step.reason}
            onClose={onClose}
            onRetry={isRetryableReason(step.reason) ? runImport : undefined}
          />
        ) : (
          <ConfigureStep
            source={source}
            destinationEnvironmentName={destinationEnvironmentName}
            targetProfiles={targetProfiles}
            canCreateProfile={canCreateProfile}
            sourceProfileDirectory={sourceProfileDirectory}
            onSourceProfileChange={setSourceProfileDirectory}
            target={target}
            onTargetChange={(selection) => {
              setTarget(selection);
              setTargetError(undefined);
            }}
            targetError={targetError ? t(targetError) : undefined}
            onCancel={onClose}
            onImport={runImport}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function QuitStep({
  source,
  onCancel,
  onRechecked,
}: {
  readonly source: BrowserImportSource;
  readonly onCancel: () => void;
  readonly onRechecked: () => void;
}) {
  const t = useTranslate();
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("integrations.import.quit-title", { source: source.name })}</DialogTitle>
        <DialogDescription>
          {t("integrations.import.quit-description", { source: source.name })}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {t("integrations.cancel")}
        </Button>
        <Button onClick={onRechecked}>{t("integrations.import.quit-confirm")}</Button>
      </DialogFooter>
    </>
  );
}

/** "5,065 cookies", or "no cookies", or nothing when the store is unreadable. */
function cookieCountLabel(count: number | undefined, t: TFunction): string | undefined {
  if (count === undefined) return undefined;
  if (count === 0) return t("integrations.import.cookies.none");
  return t("integrations.import.cookies", {
    count,
    number: new Intl.NumberFormat(i18n.resolvedLanguage).format(count),
  });
}

type ConfigureStepProps = {
  readonly source: BrowserImportSource;
  readonly destinationEnvironmentName: string;
  readonly targetProfiles: ReadonlyArray<WizardTargetProfile>;
  readonly canCreateProfile: boolean;
  readonly sourceProfileDirectory: string;
  readonly onSourceProfileChange: (directory: string) => void;
  readonly target: WizardTargetSelection;
  readonly targetError: string | undefined;
  readonly onTargetChange: (target: WizardTargetSelection) => void;
  readonly onCancel: () => void;
  readonly onImport: () => void;
};

function FullDiskAccessStep({
  source,
  onCancel,
  onOpenSettings,
  onGranted,
  stillRequired,
  onCheck,
}: {
  readonly source: BrowserImportSource;
  readonly onCancel: () => void;
  readonly onOpenSettings: () => void | Promise<void>;
  readonly onCheck: () => Promise<boolean>;
  readonly onGranted: () => void;
  readonly stillRequired: boolean;
}) {
  const t = useTranslate();
  const [opening, setOpening] = useState(false);
  const [openingError, setOpeningError] = useState<MessageKey | null>(null);
  const permission = usePermissionStatus(async () => ({ fullDiskAccess: await onCheck() }), {
    fullDiskAccess: false,
  });
  const allow = () => {
    if (opening) return;
    setOpening(true);
    setOpeningError(null);
    void Promise.resolve()
      .then(onOpenSettings)
      .catch(() => setOpeningError("integrations.import.fda-opening-error"))
      .finally(() => setOpening(false));
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t("integrations.import.fda-dialog-title", { source: source.name })}
        </DialogTitle>
        <DialogDescription>
          {t("integrations.import.fda-description", { source: source.name })}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <PermissionChecklist
          busy={opening}
          permissions={[
            {
              id: "fullDiskAccess",
              icon: (
                <HardDriveIcon
                  className="size-8 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              ),
              title: t("integrations.import.fda-title"),
              description: t("integrations.import.fda-permission-description", {
                source: source.name,
              }),
              granted: permission.status.fullDiskAccess,
              onAllow: () => void allow(),
            },
          ]}
        />
        {openingError || permission.error ? (
          <p role="status" className="mt-3 text-xs text-muted-foreground">
            {openingError ? t(openingError) : permission.error}
          </p>
        ) : null}
        {!permission.isReady(["fullDiskAccess"]) ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {stillRequired
              ? t("integrations.import.fda-still-required")
              : t("integrations.import.fda-restart")}
          </p>
        ) : null}
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {t("integrations.cancel")}
        </Button>
        <PermissionContinueButton
          ready={permission.isReady(["fullDiskAccess"])}
          busy={opening}
          onClick={onGranted}
        >
          {t("integrations.continue")}
        </PermissionContinueButton>
      </DialogFooter>
    </>
  );
}
function ConfigureStep({
  source,
  destinationEnvironmentName,
  targetProfiles,
  canCreateProfile,
  sourceProfileDirectory,
  onSourceProfileChange,
  target,
  targetError,
  onTargetChange,
  onCancel,
  onImport,
}: ConfigureStepProps) {
  const t = useTranslate();
  const targetMissing =
    target.kind === "existing" &&
    !targetProfiles.some((profile) => profile.id === target.profileId);
  // The "New profile" tile is unrendered once the cap is reached, so a target
  // chosen before that leaves nothing selected in "Into" — say so, the same
  // way a vanished existing target is explained.
  const targetUncreatable = target.kind === "new" && !canCreateProfile;
  const targetFeedback =
    targetError ??
    (targetMissing
      ? t("integrations.import.target-missing")
      : targetUncreatable
        ? t("integrations.import.target-limit")
        : undefined);
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t("integrations.import.configure-title", { source: source.name })}
        </DialogTitle>
        <DialogDescription>
          {t("integrations.import.configure-description", {
            environment: destinationEnvironmentName,
          })}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        {/* Side by side when the dialog has room, stacked when it doesn't. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <section className="flex-1 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("integrations.import.from")}
            </p>
            {source.profiles.map((profile) => (
              <SelectableTile
                key={profile.directory}
                selected={sourceProfileDirectory === profile.directory}
                title={profile.name}
                subtitle={cookieCountLabel(profile.cookieCount, t)}
                onSelect={() => onSourceProfileChange(profile.directory)}
              />
            ))}
          </section>
          <div className="flex shrink-0 items-center justify-center text-muted-foreground">
            <ArrowDownIcon className="size-4 sm:hidden" />
            <ArrowRightIcon className="hidden size-4 sm:block" />
          </div>
          <section className="flex-1 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("integrations.import.into")}
            </p>
            {canCreateProfile ? (
              <SelectableTile
                selected={target.kind === "new"}
                title={t("integrations.profiles.new")}
                subtitle={t("integrations.import.created")}
                onSelect={() => onTargetChange({ kind: "new" })}
              />
            ) : null}
            {targetProfiles.map((profile) => (
              <SelectableTile
                key={profile.id}
                selected={target.kind === "existing" && target.profileId === profile.id}
                title={browserProfileDisplayName(profile, t)}
                subtitle={t("integrations.import.existing")}
                onSelect={() => onTargetChange({ kind: "existing", profileId: profile.id })}
              />
            ))}
          </section>
        </div>
        {targetFeedback ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {targetFeedback}
          </p>
        ) : null}
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {t("integrations.cancel")}
        </Button>
        <Button
          disabled={sourceProfileDirectory === "" || targetMissing || targetUncreatable}
          onClick={onImport}
        >
          {t("integrations.import.action")}
        </Button>
      </DialogFooter>
    </>
  );
}

/** One selectable option: a name, an optional detail line, and a check. */
function SelectableTile({
  selected,
  title,
  subtitle,
  onSelect,
}: {
  readonly selected: boolean;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        selected
          ? "border-primary bg-primary/8"
          : "border-border/60 hover:border-border hover:bg-muted/40",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        {subtitle ? (
          <span className="block truncate text-xs tabular-nums text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-full border",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {selected ? <CheckIcon className="size-2.5" /> : null}
      </span>
    </button>
  );
}

function ImportingStep() {
  const t = useTranslate();
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("integrations.import.title")}</DialogTitle>
        <DialogDescription>{t("integrations.import.wait")}</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex items-center gap-3 py-2">
          <Spinner size="md" tone="muted" />
          <span className="text-sm text-muted-foreground">{t("integrations.import.progress")}</span>
        </div>
      </DialogPanel>
    </>
  );
}

function CheckingStep({
  sourceName,
  check,
}: {
  readonly sourceName: string;
  readonly check: "browser" | "fullDiskAccess";
}) {
  const t = useTranslate();
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("integrations.import.check-title", { source: sourceName })}</DialogTitle>
        <DialogDescription>
          {check === "fullDiskAccess"
            ? t("integrations.import.check-fda")
            : t("integrations.import.check-quit")}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex items-center gap-3 py-2">
          <Spinner size="md" tone="muted" />
          <span className="text-sm text-muted-foreground">
            {check === "fullDiskAccess"
              ? t("integrations.import.check-access")
              : t("integrations.import.checking")}
          </span>
        </div>
      </DialogPanel>
    </>
  );
}

function DoneStep({
  imported,
  skipped,
  skippedDomains,
  targetName,
  destinationEnvironmentName,
  onClose,
}: {
  readonly imported: number;
  readonly skipped: number;
  readonly skippedDomains: ReadonlyArray<string>;
  readonly targetName: string;
  readonly destinationEnvironmentName: string;
  readonly onClose: () => void;
}) {
  const t = useTranslate();
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {imported > 0
            ? t("integrations.import.imported", {
                count: imported,
                number: new Intl.NumberFormat(i18n.resolvedLanguage).format(imported),
              })
            : skipped > 0
              ? t("integrations.import.skipped-title", {
                  count: skipped,
                  number: new Intl.NumberFormat(i18n.resolvedLanguage).format(skipped),
                })
              : t("integrations.import.none-found")}
        </DialogTitle>
        <DialogDescription>
          {imported > 0
            ? t(skipped > 0 ? "integrations.import.added-skipped" : "integrations.import.added", {
                profile: targetName,
                environment: destinationEnvironmentName,
                count: skipped,
                number: new Intl.NumberFormat(i18n.resolvedLanguage).format(skipped),
              })
            : skipped > 0
              ? t("integrations.import.no-imported", { environment: destinationEnvironmentName })
              : t("integrations.import.no-cookies", { environment: destinationEnvironmentName })}
        </DialogDescription>
      </DialogHeader>
      {skippedDomains.length > 0 ? (
        <DialogPanel>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("integrations.import.skipped")}
          </p>
          <p className="mt-1 text-sm text-foreground">{formatSkippedDomains(skippedDomains, t)}</p>
        </DialogPanel>
      ) : null}
      <DialogFooter>
        <DialogClose render={<Button />} onClick={onClose}>
          {t("integrations.done")}
        </DialogClose>
      </DialogFooter>
    </>
  );
}

function BlockedStep({
  source,
  reason,
  onClose,
  onRetry,
}: {
  readonly source: BrowserImportSource;
  readonly reason: keyof typeof BROWSER_IMPORT_FAILURE_COPY;
  readonly onClose: () => void;
  readonly onRetry: (() => void) | undefined;
}) {
  const t = useTranslate();
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("integrations.import.blocked-title", { source: source.name })}</DialogTitle>
        <DialogDescription>
          {t(`integrations.import.failure.${reason}` as MessageKey, {
            defaultValue: BROWSER_IMPORT_FAILURE_COPY[reason],
          })}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("integrations.close")}
        </Button>
        {onRetry ? <Button onClick={onRetry}>{t("integrations.retry")}</Button> : null}
      </DialogFooter>
    </>
  );
}
