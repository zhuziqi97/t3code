import { useTranslate } from "../../i18n";
import { formatDeviceMessage } from "../device/deviceMessages";
import { useState } from "react";
import * as Option from "effect/Option";
import type { SshDeviceHostConfig } from "@t3tools/contracts";
import { CheckIcon, MonitorIcon, XIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { DeviceHostAvailability } from "../device/DeviceHostAvailability";
import { useHostConnectionChecks } from "./useHostConnectionChecks";
import {
  deviceHostConnectionKey,
  parseDeviceHostDraft,
  type DeviceHostCheckTarget,
} from "./deviceHostConnectionChecks";

export function DeviceHostEditor({
  host,
  isNew,
  targets,
  busy,
  onSave,
  onClose,
}: {
  host: SshDeviceHostConfig;
  isNew: boolean;
  targets: ReadonlyArray<DeviceHostCheckTarget>;
  busy: boolean;
  onSave: (host: SshDeviceHostConfig) => void;
  onClose: () => void;
}) {
  const t = useTranslate();
  const [draft, setDraft] = useState(host);
  const { checks, testConnection } = useHostConnectionChecks(targets);
  const results = checks[deviceHostConnectionKey(draft)];
  const checking = Object.values(results ?? {}).some((check) => check.status === "pending");
  const input = parseDeviceHostDraft({ ...draft, label: draft.label.trim() || draft.target });
  const valid = Option.isSome(input);
  const failed = Object.values(results ?? {}).filter((check) => check.status === "failed").length;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup
        showCloseButton={!busy}
        render={
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (Option.isSome(input) && draft.label.trim() && !busy && !checking)
                onSave(input.value);
            }}
          />
        }
      >
        <DialogHeader>
          <DialogTitle>{isNew ? t("device.editor.add") : t("device.editor.edit")}</DialogTitle>
          <DialogDescription>
            {targets.length === 1
              ? t("device.editor.description-single", { environment: targets[0]?.label })
              : t("device.editor.description-many", { count: targets.length })}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <label className="block space-y-1.5 text-sm">
            <span>{t("device.editor.name")}</span>
            <Input
              autoFocus
              required
              value={draft.label}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
              placeholder="Mac mini"
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span>{t("device.editor.target")}</span>
            <Input
              required
              value={draft.target}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, target: event.target.value })}
              placeholder={t("device.editor.target-placeholder")}
            />
          </label>
          <details
            open={host.port !== undefined || host.identityFile !== undefined || undefined}
            className="text-sm"
          >
            <summary className="cursor-pointer text-muted-foreground">
              {t("device.editor.options")}
            </summary>
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
              <label className="block space-y-1.5">
                <span>{t("device.editor.identity")}</span>
                <Input
                  value={draft.identityFile ?? ""}
                  disabled={busy}
                  onChange={(event) => {
                    const { identityFile: _, ...rest } = draft;
                    setDraft(
                      event.target.value ? { ...rest, identityFile: event.target.value } : rest,
                    );
                  }}
                  placeholder={t("device.editor.identity-placeholder")}
                />
              </label>
              <label className="block space-y-1.5">
                <span>{t("device.editor.port")}</span>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={draft.port ?? ""}
                  disabled={busy}
                  onChange={(event) => {
                    const { port: _, ...rest } = draft;
                    setDraft(
                      event.target.value ? { ...rest, port: Number(event.target.value) } : rest,
                    );
                  }}
                  placeholder={t("device.editor.default")}
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t("device.editor.optional")}</p>
          </details>
          <div className="rounded-lg border border-border/60">
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <p role="status" className="text-xs text-muted-foreground">
                {checking
                  ? t("device.editor.checking")
                  : results
                    ? failed
                      ? t("device.editor.failed", { count: failed, total: targets.length })
                      : t("device.editor.passed")
                    : t("device.editor.check-before-save")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || checking || !valid}
                onClick={() => {
                  if (Option.isSome(input)) void testConnection(input.value);
                }}
              >
                {checking ? <Spinner size="xs" /> : null}
                {t("device.test-connection")}
              </Button>
            </div>
            {results ? (
              <ul className="border-t border-border/60 divide-y divide-border/40">
                {targets.map((target) => {
                  const result = results[target.environmentId];
                  if (!result) return null;
                  return (
                    <li key={target.environmentId} className="px-3 py-2.5 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-medium">{target.label}</span>
                        <span
                          className={`flex shrink-0 items-center gap-1.5 ${result.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          {result.status === "pending" ? (
                            <>
                              <Spinner size="xs" />
                              {t("device.checking")}
                            </>
                          ) : result.status === "local" ? (
                            <>
                              <MonitorIcon className="size-3" />
                              {t("device.hosts.local")}
                            </>
                          ) : result.status === "failed" ? (
                            <>
                              <XIcon className="size-3" />
                              {t("device.failed")}
                            </>
                          ) : (
                            <>
                              <CheckIcon className="size-3" />
                              {t("device.connected")}
                            </>
                          )}
                        </span>
                      </div>
                      {result.status === "connected" ? (
                        <div className="mt-1.5">
                          <DeviceHostAvailability platforms={result.platforms} />
                        </div>
                      ) : null}
                      {result.status === "failed" ? (
                        <details className="mt-1.5 text-muted-foreground">
                          <summary className="cursor-pointer">
                            {t("device.editor.show-error")}
                          </summary>
                          <p className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words">
                            {formatDeviceMessage(result.error, t)}
                          </p>
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            {t("device.cancel")}
          </Button>
          <Button type="submit" disabled={busy || checking || !valid || !draft.label.trim()}>
            {busy ? <Spinner size="xs" /> : null}
            {t("device.editor.save")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
