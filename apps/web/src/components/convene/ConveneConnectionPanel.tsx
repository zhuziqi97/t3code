import { useTranslate } from "../../i18n";
import { useAtomValue } from "@effect/atom-react";
import { type ConvenePairing, type EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useId, useState } from "react";
import { CopyIcon, LoaderCircleIcon } from "lucide-react";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";

import { conveneEnvironment } from "../../state/convene";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "../ui/autocomplete";
import { Label } from "../ui/label";
import { Alert, AlertDescription } from "../ui/alert";

export function useConveneStatus(environmentId: EnvironmentId) {
  return useAtomValue(conveneEnvironment.status({ environmentId, input: {} }));
}

export function ConveneConnectionPanel({ environmentId }: { environmentId: EnvironmentId }) {
  const t = useTranslate();
  const urlId = useId();
  const result = useConveneStatus(environmentId);
  const status = AsyncResult.isSuccess(result) ? result.value : null;
  const permitted = useAtomValue(conveneEnvironment.manage.permissionAtom(environmentId));
  const manage = useAtomCommand(conveneEnvironment.manage, { reportFailure: false });
  const platformUrls = status?.platformUrls ?? [];
  const [customBaseUrl, setBaseUrl] = useState<string | null>(null);
  const baseUrl = customBaseUrl ?? platformUrls[0] ?? "";
  const [pairing, setPairing] = useState<{
    value: typeof ConvenePairing.Type;
    expiresAt: number;
    baseUrl: string;
  } | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const paired = status?.runnerId !== null && status?.runnerId !== undefined;
  const pairingError = (cause: unknown) => {
    const code = typeof cause === "object" && cause !== null && "code" in cause ? cause.code : null;
    return code === "INVALID_PLATFORM_URL"
      ? t("convene.connection.invalidUrl")
      : code === "RUNNER_PAIRING_EXPIRED" ||
          code === "RUNNER_PAIRING_INVALID" ||
          code === "RUNNER_PAIRING_CONSUMED"
        ? t("convene.connection.expired")
        : t("convene.connection.checkFailed");
  };
  // oxlint-disable-next-line t3code/react-effect-budget -- Clipboard feedback owns a timer that must be cancelled when the feedback changes or unmounts.
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  // oxlint-disable-next-line t3code/react-effect-budget -- Pairing expiry follows the server deadline and cancels its timer on completion or unmount.
  useEffect(() => {
    if (!pairing || paired) return;
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.max(0, pairing.expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [pairing, paired]);
  // oxlint-disable-next-line t3code/react-effect-budget -- Server-directed pairing exchanges stop on cancellation, expiry, errors, or revoked permission.
  useEffect(() => {
    if (!pairing || paired || expired || error || !permitted) return;
    let cancelled = false;
    let timer: number;
    const poll = async () => {
      if (Date.now() >= pairing.expiresAt) {
        setExpired(true);
        return;
      }
      const response = await manage({
        environmentId,
        input: {
          operation: "exchange",
          baseUrl: pairing.baseUrl,
          deviceCode: pairing.value.device_code,
        },
      });
      if (cancelled) return;
      if (response._tag === "Failure") {
        const cause = squashAtomCommandFailure(response);
        const code =
          typeof cause === "object" && cause !== null && "code" in cause ? cause.code : null;
        if (
          code === "RUNNER_PAIRING_EXPIRED" ||
          code === "RUNNER_PAIRING_INVALID" ||
          code === "RUNNER_PAIRING_CONSUMED"
        )
          setExpired(true);
        else setError(t("convene.connection.checkFailed"));
        return;
      }
      if (response.value.type === "status") {
        setPairing(null);
        return;
      }
      timer = window.setTimeout(poll, pairing.value.interval * 1000);
    };
    timer = window.setTimeout(poll, pairing.value.interval * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pairing, paired, expired, error, permitted, manage, environmentId, t]);
  const copy = async (kind: "code" | "link") => {
    if (!pairing) return;
    setCopyError(null);
    try {
      const didCopy = await writeTextToClipboard(
        kind === "code" ? pairing.value.user_code : pairing.value.verification_uri,
        t(kind === "code" ? "convene.connection.copyCode" : "convene.connection.copyLink"),
      );
      if (didCopy) setCopied(kind);
      else setCopyError(t("convene.connection.copyFailed"));
    } catch {
      setCopyError(t("convene.connection.copyFailed"));
    }
  };
  const run = async (input: Parameters<typeof manage>[0]["input"]) => {
    setBusy(true);
    setError(null);
    const response = await manage({ environmentId, input });
    setBusy(false);
    if (response._tag === "Failure") {
      const cause = squashAtomCommandFailure(response);
      setError(pairingError(cause));
      return;
    }
    if (response.value.type === "pairing") {
      setPairing({
        value: response.value.pairing,
        expiresAt: Date.now() + response.value.pairing.expires_in * 1000,
        baseUrl,
      });
      setExpired(false);
      setCopied(null);
      setCopyError(null);
    } else if (response.value.type === "status") {
      setPairing(null);
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("convene.connection.description")}</p>
      {status ? (
        <div className="space-y-1 text-sm">
          <p role="status">
            {status.phase === "online"
              ? t("convene.connection.online")
              : status.phase === "connecting"
                ? t("convene.connection.connecting")
                : status.phase === "offline"
                  ? t("convene.connection.offline")
                  : t("convene.connection.unpaired")}
          </p>
          {status.baseUrl && (
            <p className="break-all text-xs text-muted-foreground">{status.baseUrl}</p>
          )}
          {status.runnerId && (
            <p className="break-all text-xs text-muted-foreground">
              {t("convene.connection.clientId", { id: status.runnerId })}
            </p>
          )}
          {status.error && <p className="text-sm text-destructive">{status.error}</p>}
        </div>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {result._tag === "Failure"
            ? t("convene.connection.unavailable")
            : t("convene.connection.loading")}
        </p>
      )}
      {error && (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!permitted && (
        <p className="text-sm text-muted-foreground">{t("convene.connection.noPermission")}</p>
      )}
      {paired ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t("convene.connection.disconnectDescription")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || !permitted}
              onClick={() => void run({ operation: "reconnect" })}
            >
              {t("convene.connection.reconnect")}
            </Button>
            <Button
              variant="outline"
              disabled={busy || !permitted}
              onClick={() => void run({ operation: "disconnect" })}
            >
              {t("convene.connection.disconnect")}
            </Button>
          </div>
        </div>
      ) : pairing ? (
        <div className="space-y-3">
          <p className="text-sm">{t("convene.connection.approveCode")}</p>
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
            <strong className="font-mono text-lg tracking-wide select-text">
              {pairing.value.user_code}
            </strong>
            <Button variant="outline" size="sm" onClick={() => void copy("code")}>
              <CopyIcon className="size-4" />
              {t(copied === "code" ? "convene.connection.copied" : "convene.connection.copyCode")}
            </Button>
          </div>
          {expired ? (
            <p role="alert" className="text-sm text-destructive">
              {t("convene.connection.expired")}
            </p>
          ) : (
            <>
              {!error && (
                <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircleIcon className="size-4 animate-spin" />
                  {t("convene.connection.waiting")}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t("convene.connection.expiresAt", {
                  time: new Date(pairing.expiresAt).toLocaleTimeString(),
                })}
              </p>
            </>
          )}
          {copyError && (
            <p role="alert" className="text-sm text-destructive">
              {copyError}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {expired ? (
              <Button
                disabled={busy || !permitted}
                onClick={() => void run({ operation: "pair", baseUrl: pairing.baseUrl })}
              >
                {t("convene.connection.newCode")}
              </Button>
            ) : (
              <>
                <Button
                  onClick={() =>
                    window.open(pairing.value.verification_uri, "_blank", "noopener,noreferrer")
                  }
                >
                  {t("convene.connection.open")}
                </Button>
                <Button variant="outline" onClick={() => void copy("link")}>
                  <CopyIcon className="size-4" />
                  {t(
                    copied === "link" ? "convene.connection.copied" : "convene.connection.copyLink",
                  )}
                </Button>
                {error && (
                  <Button variant="outline" disabled={!permitted} onClick={() => setError(null)}>
                    {t("convene.connection.retryCheck")}
                  </Button>
                )}
              </>
            )}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setPairing(null);
                setError(null);
                setCopyError(null);
              }}
            >
              {t("convene.connection.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run({ operation: "pair", baseUrl });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={urlId}>{t("convene.connection.url")}</Label>
            <Autocomplete
              items={platformUrls}
              mode="none"
              value={baseUrl}
              onValueChange={(value, details) => {
                if (details.reason !== "escape-key") setBaseUrl(value);
              }}
              disabled={busy || !permitted}
            >
              <AutocompleteInput
                id={urlId}
                showTrigger
                placeholder="https://convene.example.com"
                onKeyDown={(event) => {
                  // Enter selects a suggestion; connecting requires a separate submit.
                  if (
                    event.key === "Enter" &&
                    event.currentTarget.getAttribute("aria-expanded") === "true"
                  )
                    event.preventDefault();
                }}
              />
              <AutocompletePopup>
                <AutocompleteList>
                  {(url: string) => (
                    <AutocompleteItem key={url} value={url}>
                      {url}
                    </AutocompleteItem>
                  )}
                </AutocompleteList>
              </AutocompletePopup>
            </Autocomplete>
          </div>
          <Button type="submit" disabled={busy || !baseUrl.trim() || !permitted || status === null}>
            {busy ? t("convene.connection.requesting") : t("convene.connection.connect")}
          </Button>
        </form>
      )}
    </div>
  );
}
