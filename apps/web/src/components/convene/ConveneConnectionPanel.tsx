import { useAtomValue } from "@effect/atom-react";
import { type ConvenePairing, type EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useId, useState } from "react";

import { conveneEnvironment } from "../../state/convene";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Alert, AlertDescription } from "../ui/alert";

export function useConveneStatus(environmentId: EnvironmentId) {
  return useAtomValue(conveneEnvironment.status({ environmentId, input: {} }));
}

export function ConveneConnectionPanel({ environmentId }: { environmentId: EnvironmentId }) {
  const urlId = useId();
  const result = useConveneStatus(environmentId);
  const status = AsyncResult.isSuccess(result) ? result.value : null;
  const permitted = useAtomValue(conveneEnvironment.manage.permissionAtom(environmentId));
  const manage = useAtomCommand(conveneEnvironment.manage, { reportFailure: false });
  const [baseUrl, setBaseUrl] = useState("");
  const [pairing, setPairing] = useState<{
    value: typeof ConvenePairing.Type;
    expiresAt: number;
    baseUrl: string;
  } | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!pairing) return;
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.max(0, pairing.expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [pairing]);
  const run = async (input: Parameters<typeof manage>[0]["input"]) => {
    setBusy(true);
    setError(null);
    const response = await manage({ environmentId, input });
    setBusy(false);
    if (response._tag === "Failure") {
      const cause = squashAtomCommandFailure(response);
      setError(cause instanceof Error ? cause.message : "Could not update the Convene connection.");
      return;
    }
    if (response.value.type === "pairing") {
      setPairing({
        value: response.value.pairing,
        expiresAt: Date.now() + response.value.pairing.expires_in * 1000,
        baseUrl,
      });
      setExpired(false);
    } else setPairing(null);
  };
  const paired = status?.runnerId !== null && status?.runnerId !== undefined;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Connect this environment to your Convene account to configure project modules and MCP
        access. Local development remains available without a connection.
      </p>
      {status ? (
        <div className="space-y-1 text-sm">
          <p role="status">
            {status.phase === "online"
              ? "Connected to Convene"
              : status.phase === "connecting"
                ? "Connecting to Convene…"
                : status.phase === "offline"
                  ? "Convene is offline"
                  : "Not connected to Convene"}
          </p>
          {status.baseUrl && (
            <p className="break-all text-xs text-muted-foreground">{status.baseUrl}</p>
          )}
          {status.runnerId && (
            <p className="break-all text-xs text-muted-foreground">Client ID: {status.runnerId}</p>
          )}
          {status.error && <p className="text-sm text-destructive">{status.error}</p>}
        </div>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {result._tag === "Failure"
            ? "Connection status is unavailable. Reconnect this environment to continue."
            : "Loading connection status…"}
        </p>
      )}
      {error && (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!permitted && (
        <p className="text-sm text-muted-foreground">
          This connection does not grant permission to manage environment connections.
        </p>
      )}
      {paired ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Disconnect unpairs this environment and removes its Convene associations and MCP
            configuration. Local projects and sessions remain available.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || !permitted}
              onClick={() => void run({ operation: "reconnect" })}
            >
              Reconnect
            </Button>
            <Button
              variant="outline"
              disabled={busy || !permitted}
              onClick={() => void run({ operation: "disconnect" })}
            >
              Disconnect Convene
            </Button>
          </div>
        </div>
      ) : pairing ? (
        <div className="space-y-3">
          <p className="text-sm">
            Approve this code in Convene: <strong>{pairing.value.user_code}</strong>
          </p>
          {expired ? (
            <p role="alert" className="text-sm text-destructive">
              The pairing code expired. Start again to receive a new code.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              The code expires at {new Date(pairing.expiresAt).toLocaleTimeString()}.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                window.open(pairing.value.verification_uri, "_blank", "noopener,noreferrer")
              }
              disabled={expired}
            >
              Open Convene
            </Button>
            <Button
              disabled={busy || expired || !permitted}
              onClick={() =>
                void run({
                  operation: "exchange",
                  baseUrl: pairing.baseUrl,
                  deviceCode: pairing.value.device_code,
                })
              }
            >
              {busy ? "Checking approval…" : "I've approved"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setPairing(null);
                setError(null);
              }}
            >
              Cancel pairing
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
            <Label htmlFor={urlId}>Convene platform URL</Label>
            <Input
              id={urlId}
              placeholder="https://convene.example.com"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              disabled={busy || !permitted}
            />
          </div>
          <Button type="submit" disabled={busy || !baseUrl.trim() || !permitted || status === null}>
            {busy ? "Requesting code…" : "Connect Convene"}
          </Button>
        </form>
      )}
    </div>
  );
}
