import { useTranslate } from "../../i18n";
import type { BitbucketSettings, EnvironmentId } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

type CredentialMethod = "access-token" | "api-token";

const METHODS: Record<
  CredentialMethod,
  {
    readonly label: string;
    readonly description: string;
    readonly link: string;
    readonly linkLabel: string;
  }
> = {
  "access-token": {
    label: "sourceControl.bitbucket.accessToken",
    description: "sourceControl.bitbucket.accessDescription",
    link: "https://support.atlassian.com/bitbucket-cloud/docs/access-tokens/",
    linkLabel: "sourceControl.bitbucket.learnMore",
  },
  "api-token": {
    label: "sourceControl.bitbucket.apiToken",
    description: "sourceControl.bitbucket.apiDescription",
    link: "https://id.atlassian.com/manage-profile/security/api-tokens",
    linkLabel: "sourceControl.bitbucket.createApiToken",
  },
};

function savedMethod(saved: BitbucketSettings): CredentialMethod | null {
  if (saved.accessToken.length > 0) return "access-token";
  if (saved.email.length > 0 && saved.apiToken.length > 0) return "api-token";
  return null;
}

/** A write-only token field. It never shows the saved token; typing a new one replaces it. */
function TokenInput({
  id,
  isSaved,
  draft,
  onDraftChange,
}: {
  readonly id: string;
  readonly isSaved: boolean;
  readonly draft: string;
  readonly onDraftChange: (draft: string) => void;
}) {
  const t = useTranslate();
  return (
    <Input
      id={id}
      type="password"
      autoComplete="off"
      size="sm"
      placeholder={isSaved ? t("sourceControl.secretStored") : t("common.notSet")}
      value={draft}
      onChange={(event) => onDraftChange(event.target.value)}
    />
  );
}

/**
 * Bitbucket credentials for one environment: an access token or an Atlassian
 * account email + API token, never both. Tokens are write-only: the server
 * keeps them in its secret store and only reports whether each one is set.
 */
export function BitbucketCredentialsSettings({
  environmentId,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly onSaved: () => void;
}) {
  const t = useTranslate();
  const saved = useEnvironmentSettings(environmentId, (settings) => settings.bitbucket);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: t("sourceControl.bitbucket.saveCredentials"),
  });
  const [methodChoice, setMethodChoice] = useState<CredentialMethod | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [emailDraft, setEmailDraft] = useState<string | null>(null);
  const [apiToken, setApiToken] = useState("");
  const [saving, setSaving] = useState(false);
  const current = savedMethod(saved);
  const method = methodChoice ?? current ?? "access-token";
  const methodIsSaved = current === method;
  const email = (emailDraft ?? saved.email).trim();
  const newAccessToken = accessToken.trim();
  const newApiToken = apiToken.trim();
  const info = METHODS[method];

  // Saving one method clears the other, so a hidden credential never wins over the visible one.
  const patch: BitbucketSettings | null =
    method === "access-token"
      ? newAccessToken
        ? { accessToken: newAccessToken, email: "", apiToken: "" }
        : null
      : email && (newApiToken || saved.apiToken)
        ? // Resending the saved token's redacted value keeps it.
          { accessToken: "", email, apiToken: newApiToken || saved.apiToken }
        : null;
  const canSave =
    patch !== null &&
    (method === "access-token" || !methodIsSaved || newApiToken !== "" || email !== saved.email);

  const save = async (next: BitbucketSettings) => {
    setSaving(true);
    try {
      const result = await updateSettings({
        environmentId,
        input: { patch: { bitbucket: next } },
      });
      if (result._tag === "Success") {
        setAccessToken("");
        setApiToken("");
        setEmailDraft(null);
        onSaved();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave && patch) void save(patch);
      }}
    >
      {/* Locked while saving: a successful save clears the drafts, which would drop edits made mid-request. */}
      <fieldset disabled={saving} className="contents">
        <ToggleGroup
          aria-label={t("sourceControl.bitbucket.method")}
          variant="segmented"
          value={[method]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "access-token" || value === "api-token") setMethodChoice(value);
          }}
        >
          <Toggle value="access-token">{t(METHODS["access-token"].label)}</Toggle>
          <Toggle value="api-token">{t(METHODS["api-token"].label)}</Toggle>
        </ToggleGroup>
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {t(info.description)}{" "}
          <InlineButton render={<a href={info.link} target="_blank" rel="noreferrer noopener" />}>
            {t(info.linkLabel)}
            <ExternalLinkIcon aria-hidden className="size-3" />
          </InlineButton>
        </p>
        {method === "access-token" ? (
          <div className="grid gap-1.5">
            <Label htmlFor={`bitbucket-access-token-${environmentId}`}>
              {t("sourceControl.bitbucket.accessToken")}
            </Label>
            <TokenInput
              id={`bitbucket-access-token-${environmentId}`}
              isSaved={methodIsSaved}
              draft={accessToken}
              onDraftChange={setAccessToken}
            />
          </div>
        ) : (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor={`bitbucket-email-${environmentId}`}>
                {t("sourceControl.bitbucket.email")}
              </Label>
              <Input
                id={`bitbucket-email-${environmentId}`}
                type="email"
                autoComplete="off"
                size="sm"
                placeholder="you@example.com"
                value={emailDraft ?? saved.email}
                onChange={(event) => setEmailDraft(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`bitbucket-api-token-${environmentId}`}>
                {t("sourceControl.bitbucket.apiToken")}
              </Label>
              <TokenInput
                id={`bitbucket-api-token-${environmentId}`}
                isSaved={methodIsSaved}
                draft={apiToken}
                onDraftChange={setApiToken}
              />
            </div>
          </>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {current === null
              ? t("sourceControl.bitbucket.noToken")
              : methodIsSaved
                ? null
                : t("sourceControl.bitbucket.replaces", {
                    method: t(METHODS[current].label).toLowerCase(),
                  })}
          </p>
          <div className="flex shrink-0 gap-2">
            {current !== null ? (
              <Button
                size="xs"
                variant="outline"
                disabled={saving}
                onClick={() => void save({ accessToken: "", email: "", apiToken: "" })}
              >
                {t("common.remove")}
              </Button>
            ) : null}
            <Button type="submit" size="xs" disabled={!canSave || saving}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
