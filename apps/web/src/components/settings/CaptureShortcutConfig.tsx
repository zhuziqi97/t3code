import { i18n, useTranslate } from "../../i18n";
import { formatSnapShotMessage } from "./snapShotMessages";
import type { MessageKey } from "@t3tools/client-runtime/i18n";
import {
  isModifierPairShortcut,
  type DesktopCaptureConfigApplied,
  type DesktopCaptureConfigPreview,
  type DesktopSnapShotState,
} from "@t3tools/contracts";
import { parseKeybindingShortcut } from "@t3tools/shared/keybindings";
import { FileDiff } from "@pierre/diffs/react";
import { parseDiffFromFile } from "@pierre/diffs";
import { useMemo, useState } from "react";
import { getDesktopSnapShotBridge } from "../../lib/desktopSnapShot";
import { resolveDiffThemeName } from "../../lib/diffRendering";
import { useTheme } from "../../hooks/useTheme";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { shortcutToKeybindingInput } from "./KeybindingsSettings.logic";
import { useSnapShotShortcutRecorder } from "./useSnapShotShortcutRecorder";

const DEFAULT_SHORTCUT = parseKeybindingShortcut("Ctrl+Shift+2")!;

/** Wizard-owned config review; config contents never leave the desktop bridge. */
export function CaptureShortcutConfig({
  state,
  disabled = false,
  onBusyChange,
  onSaved,
  onComplete,
}: {
  state: DesktopSnapShotState;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onSaved?: () => Promise<unknown>;
  onComplete?: () => Promise<void>;
}) {
  const t = useTranslate();
  const bridge = getDesktopSnapShotBridge();
  const { resolvedTheme } = useTheme();
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const [preview, setPreview] = useState<DesktopCaptureConfigPreview | null>(null);
  const [result, setResult] = useState<DesktopCaptureConfigApplied | null>(null);
  const [error, setError] = useState<
    (({ key: MessageKey } | { message: string }) & { detail?: string }) | null
  >(null);
  const [working, setWorking] = useState<"reading" | "writing" | null>(null);
  const [keys, setKeys] = useState<string | null>(null);
  const [customFile, setCustomFile] = useState(false);
  const busy = disabled || working !== null;
  const supported = Boolean(bridge?.previewSnapShotConfig && bridge.applySnapShotConfig);
  const changed = preview !== null && preview.before !== preview.after;
  const niri = state.linuxBackend === "niri";
  const desktop = niri ? "Niri" : "Hyprland";
  const shortcutKeys = (keys ?? preview?.shortcut)?.trim();
  const recorder = useSnapShotShortcutRecorder({
    shortcut: shortcutKeys
      ? (parseKeybindingShortcut(shortcutKeys.replace(/super/gi, "meta")) ?? DEFAULT_SHORTCUT)
      : DEFAULT_SHORTCUT,
    disabled: busy,
    allowModifierPairs: false,
    onStart: () => setError(null),
    onError: (message) => setError({ message }),
    onRecord: (shortcut) => {
      if (isModifierPairShortcut(shortcut)) return;
      setKeys(
        shortcutToKeybindingInput({
          ...shortcut,
          ctrlKey: shortcut.ctrlKey || shortcut.modKey,
          modKey: false,
        }),
      );
      setPreview(null);
      setError(null);
    },
  });
  const actionBusy = busy || recorder.recording;
  const diff = useMemo(
    () =>
      preview && changed
        ? parseDiffFromFile(
            { name: preview.path, contents: preview.before },
            { name: preview.path, contents: preview.after },
          )
        : null,
    [preview, changed],
  );
  const begin = (phase: "reading" | "writing") => {
    setWorking(phase);
    onBusyChange?.(true);
    setError(null);
  };
  const end = () => {
    setWorking(null);
    onBusyChange?.(false);
  };
  const read = async (chooseFile = customFile, operation: "install" | "remove" = "install") => {
    if (actionBusy || !bridge?.previewSnapShotConfig) return;
    begin("reading");
    setPreview(null);
    setResult(null);
    setCustomFile(chooseFile);
    try {
      setPreview(
        await bridge.previewSnapShotConfig({
          operation,
          chooseFile,
          ...(keys?.trim() ? { shortcut: keys.trim() } : {}),
        }),
      );
    } catch (cause) {
      setError({
        key: "snapshots.config.prepare-failed",
        ...(cause instanceof Error ? { detail: cause.message } : {}),
      });
    } finally {
      end();
    }
  };
  const apply = async () => {
    if (actionBusy || !preview || !bridge?.applySnapShotConfig) return;
    begin("writing");
    try {
      const applied = await bridge.applySnapShotConfig(preview.id);
      setResult(applied);
      await onSaved?.();
      if (!applied.warning && preview.operation === "install" && onComplete) {
        toastManager.add({
          type: "success",
          title: i18n.t("snapshots.status.saved"),
          description: i18n.t("snapshots.config.use-shortcut", { shortcut: preview.shortcut }),
        });
        await onComplete();
      }
    } catch (cause) {
      setError({
        key: "snapshots.config.save-failed",
        ...(cause instanceof Error ? { detail: cause.message } : {}),
      });
      setPreview(null);
    } finally {
      end();
    }
  };

  return (
    <div className="space-y-4 text-sm">
      {!result ? (
        <div className="flex items-center justify-between gap-3">
          <span>{t("snapshots.shortcut")}</span>
          {recorder.input}
        </div>
      ) : null}
      {recorder.recording ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("snapshots.recording")}
        </p>
      ) : null}
      {result ? (
        <p role="status">
          {result.warning
            ? t("snapshots.config.warning")
            : preview?.operation === "remove"
              ? t("snapshots.config.removed")
              : t("snapshots.config.use-window", { shortcut: preview?.shortcut })}
        </p>
      ) : preview ? (
        <>
          <p className="text-muted-foreground">
            {changed
              ? preview.operation === "remove"
                ? t("snapshots.config.review-remove")
                : t("snapshots.config.review-save")
              : preview.operation === "remove"
                ? t("snapshots.config.no-remove")
                : t("snapshots.config.already")}
          </p>
          {diff ? (
            <div
              className="max-h-80 overflow-auto rounded-lg border text-xs"
              aria-label={t("snapshots.config.changes")}
            >
              <FileDiff
                fileDiff={diff}
                options={{
                  diffStyle: "unified",
                  theme: resolveDiffThemeName(resolvedTheme),
                  overflow: "wrap",
                }}
              />
            </div>
          ) : null}
          {changed ? (
            <p className="text-xs text-muted-foreground">
              {t("snapshots.config.backup-description")}
            </p>
          ) : null}
          <div className="flex gap-2">
            {changed || preview.operation === "install" ? (
              <Button
                disabled={
                  actionBusy ||
                  (preview.operation === "install" && state.shortcutActionRegistered === false)
                }
                aria-busy={working === "writing"}
                onClick={() => void apply()}
              >
                {working === "writing"
                  ? t("snapshots.saving")
                  : changed
                    ? preview.operation === "install"
                      ? t("snapshots.config.save")
                      : t("snapshots.config.remove")
                    : t("snapshots.done")}
              </Button>
            ) : null}
            <Button variant="ghost" disabled={actionBusy} onClick={() => setPreview(null)}>
              {t("snapshots.cancel")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-muted-foreground">{t("snapshots.config.read-description")}</p>
          <Button
            disabled={actionBusy || !supported}
            aria-busy={working === "reading"}
            onClick={() => void read()}
          >
            {working === "reading" ? t("snapshots.config.preparing") : t("snapshots.config.review")}
          </Button>
          {!supported ? (
            <p className="text-xs text-muted-foreground">{t("snapshots.config.update-app")}</p>
          ) : null}
        </>
      )}
      {error ? (
        <p role="alert" className="text-destructive">
          {"key" in error ? t(error.key) : formatSnapShotMessage(error.message, t)}
        </p>
      ) : null}
      {state.shortcutActionRegistered === false && state.shortcutMessage ? (
        <p role="status" className="text-muted-foreground">
          {state.shortcutPending ? t("snapshots.config.connecting") : t("snapshots.config.restart")}
        </p>
      ) : null}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">{t("snapshots.advanced")}</summary>
        <div className="mt-3 space-y-3">
          {error?.detail || result?.warning ? (
            <div className="space-y-1">
              <p className="font-medium text-foreground">{t("snapshots.config.troubleshoot")}</p>
              <p className="break-words">
                {formatSnapShotMessage(error?.detail ?? result?.warning ?? "", t)}
              </p>
            </div>
          ) : null}
          <div className="space-y-1">
            <p className="font-medium text-foreground">{t("snapshots.config.file")}</p>
            <p className="break-all font-mono">
              {preview?.path ??
                state.shortcutConfigPath ??
                (niri ? "~/.config/niri/config.kdl" : "~/.config/hypr/hyprland.conf")}
            </p>
            {niri ? <p>{t("snapshots.config.includes")}</p> : null}
            {preview && preview.resolvedPath !== preview.path ? (
              <p className="break-all">
                {t("snapshots.config.link", { path: preview.resolvedPath })}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={actionBusy || !supported}
              onClick={() => void read(true)}
            >
              {t("snapshots.config.choose-file")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={actionBusy || !supported}
              onClick={() => void read(customFile, "remove")}
            >
              {t("snapshots.config.remove-action")}
            </Button>
            {result ? (
              <Button
                size="sm"
                variant="outline"
                disabled={actionBusy || !supported}
                onClick={() => void read()}
              >
                {t("snapshots.config.review")}
              </Button>
            ) : null}
          </div>
          <p>{t(niri ? "snapshots.config.niri-location" : "snapshots.config.hypr-location")}</p>
          {result?.backupPath ? (
            <p className="break-all">{t("snapshots.config.backup", { path: result.backupPath })}</p>
          ) : null}
          <p className="font-medium text-foreground">{t("snapshots.config.manual")}</p>
          <p>{t(niri ? "snapshots.config.manual-niri" : "snapshots.config.manual-hypr")}</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-muted/50 p-3">
            {state.shortcutBinding}
          </pre>
          <Button
            size="sm"
            variant="outline"
            disabled={actionBusy || !state.shortcutBinding}
            onClick={() => {
              if (state.shortcutBinding) copyToClipboard(state.shortcutBinding);
            }}
          >
            {isCopied ? t("snapshots.config.copied") : t("snapshots.config.copy")}
          </Button>
          <p>{t("snapshots.config.stop", { desktop })}</p>
          {state.shortcutActionRegistered === false ? (
            <p role="status">
              {state.shortcutMessage ? formatSnapShotMessage(state.shortcutMessage, t) : null}
            </p>
          ) : null}
          {onComplete ? (
            <Button
              size="sm"
              variant="outline"
              disabled={actionBusy || state.shortcutActionRegistered === false}
              onClick={() => void onComplete()}
            >
              {t("snapshots.config.added")}
            </Button>
          ) : null}
        </div>
      </details>
    </div>
  );
}
