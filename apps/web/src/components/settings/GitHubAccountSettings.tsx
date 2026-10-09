import { useTranslate } from "../../i18n";
import { Trans } from "react-i18next";
import type { EnvironmentId, SourceControlProviderAuth } from "@t3tools/contracts";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { groupGitHubAccounts, nextGitHubHosts } from "./GitHubAccountSettings.logic";
import { redactedPlaceholder } from "./RedactedSensitiveText";

/** Sentinel select value for "follow gh's active login"; logins never contain spaces. */
const ACTIVE_ACCOUNT = "active gh account";

/**
 * A login, blurred like RedactedSensitiveText until the panel reveals it. Plain text, not a
 * button, so it can sit inside select options; one panel toggle reveals every login.
 */
function RedactedLogin(props: {
  readonly account: string;
  readonly revealed: boolean;
  /** Distinguishes hidden logins from each other for a screen reader, e.g. "Account 2". */
  readonly label?: string;
}) {
  const t = useTranslate();
  return props.revealed ? (
    <span className="min-w-0 truncate font-mono text-2xs">{props.account}</span>
  ) : (
    <span className="min-w-0 truncate font-mono text-2xs">
      <span className="select-none blur-xs" aria-hidden>
        {redactedPlaceholder(props.account)}
      </span>
      <span className="sr-only">{props.label ?? t("sourceControl.github.hiddenAccount")}</span>
    </span>
  );
}

/**
 * Per-host GitHub choices for one environment: turn a host off, or pin which of the
 * logins `gh` holds is used instead of its active one. Changes save immediately.
 */
export function GitHubAccountSettings({
  environmentId,
  auth,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly auth: SourceControlProviderAuth;
  readonly onSaved: () => void;
}) {
  const t = useTranslate();
  const hosts = useEnvironmentSettings(environmentId, (settings) => settings.github.hosts);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: t("sourceControl.github.saveAccounts"),
  });
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const groups = groupGitHubAccounts(auth.accounts ?? []);

  const save = async (
    host: string,
    change: { readonly enabled?: boolean; readonly account?: string | null },
  ) => {
    setSaving(true);
    try {
      const result = await updateSettings({
        environmentId,
        input: { patch: { github: { hosts: nextGitHubHosts(hosts, host, change) } } },
      });
      if (result._tag === "Success") onSaved();
    } finally {
      setSaving(false);
    }
  };

  if (groups.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        <Trans
          t={t}
          i18nKey="sourceControl.github.signInHint"
          components={{ command: <code className="rounded bg-muted px-1 py-px text-2xs" /> }}
        />
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          <Trans
            t={t}
            i18nKey="sourceControl.github.chooseHint"
            components={{ command: <code className="rounded bg-muted px-1 py-px text-2xs" /> }}
          />
        </p>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          onClick={() => setRevealed((current) => !current)}
          aria-label={
            revealed
              ? t("sourceControl.github.hideAccounts")
              : t("sourceControl.github.revealAccounts")
          }
          aria-pressed={revealed}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
      </div>
      {groups.map((group) => {
        const choice = hosts[group.host];
        const enabled = choice?.enabled ?? true;
        const stalePin =
          choice?.account !== undefined && !group.selectable.includes(choice.account);
        const pinned = choice?.account !== undefined && !stalePin ? choice.account : ACTIVE_ACCOUNT;
        return (
          <div key={group.host} className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <span className="text-xs font-medium text-foreground">{group.host}</span>
                {group.selectable.length === 1 && group.selectable[0] !== undefined ? (
                  <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                    <span>{t("sourceControl.github.signedIn")}</span>
                    <RedactedLogin revealed={revealed} account={group.selectable[0]} />
                  </p>
                ) : null}
              </div>
              <Switch
                checked={enabled}
                disabled={saving}
                aria-label={t("sourceControl.github.useHost", { host: group.host })}
                onCheckedChange={(checked) => void save(group.host, { enabled: checked })}
              />
            </div>
            {group.selectable.length > 1 ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  {t("sourceControl.github.account")}
                </span>
                <div className="w-64 max-w-full">
                  <Select
                    value={pinned}
                    disabled={saving || !enabled}
                    onValueChange={(value) => {
                      if (typeof value !== "string") return;
                      void save(group.host, {
                        account: value === ACTIVE_ACCOUNT ? null : value,
                      });
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      aria-label={t("sourceControl.github.hostAccount", { host: group.host })}
                    >
                      <SelectValue>
                        {(value: string) =>
                          value === ACTIVE_ACCOUNT ? (
                            <span className="flex min-w-0 items-center gap-1">
                              {t("sourceControl.github.activeAccount")}
                              {group.activeAccount ? (
                                <>
                                  (
                                  <RedactedLogin
                                    revealed={revealed}
                                    account={group.activeAccount}
                                  />
                                  )
                                </>
                              ) : null}
                            </span>
                          ) : (
                            <RedactedLogin revealed={revealed} account={value} />
                          )
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      <SelectItem value={ACTIVE_ACCOUNT}>
                        <span className="flex min-w-0 items-center gap-1">
                          {t("sourceControl.github.activeAccount")}
                          {group.activeAccount ? (
                            <>
                              (<RedactedLogin revealed={revealed} account={group.activeAccount} />)
                            </>
                          ) : null}
                        </span>
                      </SelectItem>
                      {group.selectable.map((account, index) => (
                        <SelectItem key={account} value={account}>
                          <RedactedLogin
                            revealed={revealed}
                            account={account}
                            label={t("sourceControl.github.accountNumber", { number: index + 1 })}
                          />
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              </div>
            ) : null}
            {stalePin ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-warning">{t("sourceControl.github.stalePin")}</p>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={saving}
                  onClick={() => void save(group.host, { account: null })}
                >
                  {t("sourceControl.github.useActive")}
                </Button>
              </div>
            ) : null}
            {group.broken.map((entry) => (
              <p
                key={entry.account}
                className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground/70"
              >
                <RedactedLogin revealed={revealed} account={entry.account} />
                <span>
                  {t("sourceControl.github.invalidLogin", {
                    error: entry.error ?? t("sourceControl.github.invalidDetail"),
                  })}
                </span>
              </p>
            ))}
            {group.environmentVariable ? (
              <p className="text-xs text-warning">
                {t("sourceControl.github.environmentOverride", {
                  variable: group.environmentVariable,
                })}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
