import { Alert, AlertDescription } from "../ui/alert";
import type { AuthSessionState } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { formatConnectionErrorMessage } from "@t3tools/client-runtime/connection";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import React, { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";

import { connectPairing } from "../../connection/onboarding";
import {
  peekPairingTokenFromUrl,
  stripPairingTokenFromUrl,
  submitServerAuthCredential,
} from "../../environments/primary";
import { readHostedPairingRequest } from "../../hostedPairing";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { StandalonePage, StandalonePageHeader } from "../ui/standalone-page";
import { useAtomCommand } from "../../state/use-atom-command";
import { useTranslate } from "../../i18n";
import type { MessageResolver } from "../../i18n/messages";

export function PairingPendingSurface() {
  const gt = useGT();
  return (
    <StandalonePage>
      <StandalonePageHeader
        title={gt("Pairing with this environment")}
        description={gt("Validating the pairing link and preparing your session.")}
      />
    </StandalonePage>
  );
}

export function PairingRouteSurface({
  auth,
  initialErrorMessage,
  onAuthenticated,
}: {
  auth: AuthSessionState["auth"];
  initialErrorMessage?: string;
  onAuthenticated: () => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const t = useTranslate();
  const [autoPairToken] = useState(peekPairingTokenFromUrl);
  const [credential, setCredential] = useState(autoPairToken ?? "");
  const [errorMessage, setErrorMessage] = useState<{ message: string | null } | null>(
    initialErrorMessage ? { message: initialErrorMessage } : null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const autoSubmitAttemptedRef = useRef(false);

  const submitCredential = async (nextCredential: string) => {
    setIsSubmitting(true);
    setErrorMessage(null);

    const submitError = await submitServerAuthCredential(nextCredential).then(
      () => null,
      (error) => ({ message: errorMessageFromUnknown(error) }),
    );

    setIsSubmitting(false);

    if (submitError) {
      setErrorMessage(submitError);
      return;
    }

    startTransition(() => {
      onAuthenticated();
    });
  };

  const handleSubmit = async (event?: React.SubmitEvent<HTMLFormElement>) => {
    event?.preventDefault();
    await submitCredential(credential);
  };

  const autoSubmit = useEffectEvent((token: string) => {
    void submitCredential(token);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- strips the pairing token from the URL and submits it once when the route carries one
  useEffect(() => {
    if (!autoPairToken || autoSubmitAttemptedRef.current) {
      return;
    }

    autoSubmitAttemptedRef.current = true;
    stripPairingTokenFromUrl();
    autoSubmit(autoPairToken);
  }, [autoPairToken]);

  return (
    <StandalonePage>
      <StandalonePageHeader
        title={gt("Pair with this environment")}
        description={describeAuthGate(auth.bootstrapMethods, messages)}
      />

      <form className="mt-6 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="pairing-token">
            <T>Pairing token</T>
          </label>
          <Input
            id="pairing-token"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            disabled={isSubmitting}
            nativeInput
            onChange={(event) => setCredential(event.currentTarget.value)}
            placeholder={gt("Paste a one-time token or pairing secret")}
            spellCheck={false}
            value={credential}
          />
        </div>

        {errorMessage ? (
          <Alert variant="error">
            <AlertDescription>
              {errorMessage.message
                ? formatConnectionErrorMessage(errorMessage.message, t)
                : gt("Authentication failed.")}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button disabled={isSubmitting} size="sm" type="submit">
            {isSubmitting ? gt("Pairing...") : gt("Continue")}
          </Button>
          <Button
            disabled={isSubmitting}
            onClick={() => window.location.reload()}
            size="sm"
            variant="outline"
          >
            <T>Reload app</T>
          </Button>
        </div>
      </form>

      <div className="mt-6 rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
        {describeSupportedMethods(auth.bootstrapMethods, messages)}
      </div>
    </StandalonePage>
  );
}

export function HostedPairingRouteSurface() {
  const connectPairingEnvironment = useAtomCommand(connectPairing, {
    reportFailure: false,
  });
  const [request] = useState(readHostedPairingRequest);
  const gt = useGT();
  const t = useTranslate();
  const [status, setStatus] = useState<"pairing" | "paired" | "error">(
    request ? "pairing" : "error",
  );
  const [message, setMessage] = useState<
    | { kind: "connecting" | "missing" | "submitted" | "saved" }
    | { kind: "failed"; error: string | null }
  >(() => ({ kind: request ? "connecting" : "missing" }));
  const [canRetry, setCanRetry] = useState(false);
  const submitAttemptedRef = useRef(false);
  const tokenSubmittedRef = useRef(false);

  const submitHostedPairingRequest = async () => {
    if (!request) {
      setStatus("error");
      setMessage({ kind: "missing" });
      setCanRetry(false);
      return;
    }

    if (tokenSubmittedRef.current) {
      setStatus("error");
      setMessage({ kind: "submitted" });
      setCanRetry(false);
      return;
    }

    setStatus("pairing");
    setMessage({ kind: "connecting" });
    setCanRetry(false);
    tokenSubmittedRef.current = true;

    const result = await connectPairingEnvironment({
      host: request.host,
      pairingCode: request.token,
    });
    if (result._tag === "Success") {
      setStatus("paired");
      setMessage({ kind: "saved" });
      return;
    }

    tokenSubmittedRef.current = false;
    setStatus("error");
    setCanRetry(true);
    setMessage({
      kind: "failed",
      error: errorMessageFromUnknown(squashAtomCommandFailure(result)),
    });
  };

  const submitOnMount = useEffectEvent(() => {
    void submitHostedPairingRequest();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- strips the pairing token from the URL and submits the hosted pairing request once on mount
  useEffect(() => {
    if (submitAttemptedRef.current) {
      return;
    }
    submitAttemptedRef.current = true;

    stripPairingTokenFromUrl();
    submitOnMount();
  }, []);

  const description = (() => {
    switch (message.kind) {
      case "connecting":
        return gt("Connecting to this backend.");
      case "missing":
        return gt("This pairing link is missing its backend host or token.");
      case "submitted":
        return gt("This one-time pairing token was already submitted. Request a new pairing link.");
      case "saved":
        return request?.label
          ? gt("{environment} is saved in this browser.", { environment: request.label })
          : gt("The environment is saved in this browser.");
      case "failed":
        return gt(
          "{error} If the backend accepted this one-time token, request a new pairing link before retrying.",
          {
            error: message.error
              ? formatConnectionErrorMessage(message.error, t)
              : gt("Authentication failed."),
          },
        );
    }
  })();
  return (
    <StandalonePage>
      <StandalonePageHeader
        title={
          status === "paired"
            ? gt("Backend paired")
            : status === "error"
              ? gt("Pairing failed")
              : gt("Pairing backend")
        }
        description={description}
      />

      {request ? (
        <div className="mt-5 rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
          <T>
            Host:{" "}
            <span className="font-mono text-foreground/80">
              <Var>{request.host}</Var>
            </span>
          </T>
        </div>
      ) : null}

      {status === "error" ? (
        <Alert variant="error" className="mt-5">
          <AlertDescription>
            <T>
              Verify the backend is reachable from this browser, supports CORS for hosted clients,
              and is served over HTTPS when opening this page from HTTPS.
            </T>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {status === "pairing" ? (
          <Button disabled size="sm">
            <T>Pairing...</T>
          </Button>
        ) : canRetry ? (
          <Button size="sm" onClick={() => void submitHostedPairingRequest()}>
            <T>Try again</T>
          </Button>
        ) : null}
        {status === "paired" ? (
          <Button size="sm" variant="outline" onClick={() => (window.location.href = "/")}>
            <T>Open app</T>
          </Button>
        ) : null}
      </div>
    </StandalonePage>
  );
}

function errorMessageFromUnknown(error: unknown): string | null {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return null;
}

function describeAuthGate(
  bootstrapMethods: ReadonlyArray<string>,
  resolve: MessageResolver,
): string {
  if (bootstrapMethods.includes("desktop-bootstrap")) {
    return resolve(
      msg("This environment expects a trusted pairing credential before the app can connect."),
    );
  }

  return resolve(msg("Enter a pairing token to start a session with this environment."));
}

function describeSupportedMethods(
  bootstrapMethods: ReadonlyArray<string>,
  resolve: MessageResolver,
): string {
  if (
    bootstrapMethods.includes("desktop-bootstrap") &&
    bootstrapMethods.includes("one-time-token")
  ) {
    return resolve(
      msg(
        "Desktop-managed pairing and one-time pairing tokens are both accepted for this environment.",
      ),
    );
  }

  if (bootstrapMethods.includes("desktop-bootstrap")) {
    return resolve(
      msg(
        "This environment is desktop-managed. Open it from the desktop app or paste a bootstrap credential if one was issued explicitly.",
      ),
    );
  }

  return resolve(
    msg(
      "This environment accepts one-time pairing tokens. Pairing links can open this page directly, or you can paste the token here.",
    ),
  );
}
