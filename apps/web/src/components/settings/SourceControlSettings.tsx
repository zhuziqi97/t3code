import { useTranslate } from "../../i18n";
import { Trans } from "react-i18next";
import type { TFunction } from "i18next";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { ChevronDownIcon } from "lucide-react";
import * as Option from "effect/Option";
import { useState, type ReactNode } from "react";
import type {
  SourceControlDiscoveryResult,
  SourceControlProviderAuth,
  SourceControlProviderDiscoveryItem,
  VcsDriverKind,
  VcsDiscoveryItem,
} from "@t3tools/contracts";
import { useSettingsScope } from "./SettingsScopeContext";
import { ProjectDefaultsSettings } from "./ProjectDefaultsSettings";
import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Skeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

import { GitIcon, JujutsuIcon, type Icon } from "../Icons";
import { SourceControlHostSettings } from "./SourceControlHostSettings";
import { SourceControlAccountSettings } from "./SourceControlAccountSettings";
import { SourceControlAppSignInSettings } from "./SourceControlAppSignInSettings";
import { SourceControlTokenSettings } from "./SourceControlTokenSettings";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import { SourceControlWritingSettingsSection } from "./SourceControlWritingSettings";
import {
  SettingsPageContainer,
  SettingsSearchTarget,
  SettingsSection,
  useSettingsSearchTargetId,
} from "./settingsLayout";
import { searchableSetting, sourceControlHostSettingsSearchId } from "./settingsSearch";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { sourceControlIcon } from "~/sourceControlPresentation";

const EMPTY_DISCOVERY_RESULT: SourceControlDiscoveryResult = {
  versionControlSystems: [],
  sourceControlProviders: [],
};

const VCS_ICONS: Partial<Record<VcsDriverKind, Icon>> = {
  git: GitIcon,
  jj: JujutsuIcon,
};

const SOURCE_CONTROL_SKELETON_ROWS = ["primary", "secondary"] as const;
function optionLabel(value: Option.Option<string>): string | null {
  return Option.getOrNull(value);
}

const AUTH_DETAIL_KEYS = [
  "sourceControl.authDetail.allGithubHostsOff",
  "sourceControl.authDetail.savedGithubToken",
  "sourceControl.authDetail.oldGithubCli",
  "sourceControl.authDetail.githubUnparsed",
  "sourceControl.authDetail.gitlabUnparsed",
  "sourceControl.authDetail.azureUnparsed",
  "sourceControl.authDetail.forgejoStorage",
  "sourceControl.authDetail.bitbucketAccess",
  "sourceControl.authDetail.bitbucketApi",
] as const;

function translatedAuthDetail(detail: Option.Option<string>, t: TFunction): string | null {
  const message = optionLabel(detail);
  if (message === null) return null;
  // The discovery probes mix our own messages with raw CLI diagnostics in this field.
  const key = AUTH_DETAIL_KEYS.find((key) => t(key, { lng: "en" }) === message);
  if (key) return t(key);
  const override =
    /^Using (.+) from the server environment; it overrides the account chosen in Settings\.$/.exec(
      message,
    );
  if (override) return t("sourceControl.authDetail.environmentOverride", { variable: override[1] });
  const savedTokenPrefix = "Could not check the token saved in Settings: ";
  if (message.startsWith(savedTokenPrefix)) {
    return t("sourceControl.authDetail.checkSavedToken", {
      error: message.slice(savedTokenPrefix.length),
    });
  }
  const environmentToken = /^Could not check the token in ([A-Z_]+): ([\s\S]+)$/.exec(message);
  if (environmentToken) {
    return t("sourceControl.authDetail.checkEnvironmentToken", {
      variable: environmentToken[1],
      error: environmentToken[2],
    });
  }
  return message;
}

function isProviderDiscoveryItem(
  item: VcsDiscoveryItem | SourceControlProviderDiscoveryItem,
): item is SourceControlProviderDiscoveryItem {
  return "auth" in item;
}

function isVcsNotReady(item: VcsDiscoveryItem | SourceControlProviderDiscoveryItem): boolean {
  return !isProviderDiscoveryItem(item) && !item.implemented;
}

function authPresentation(
  auth: SourceControlProviderAuth,
  t: TFunction,
): {
  readonly label: string;
  readonly badge: "secondary" | null;
} {
  if (auth.status === "authenticated") {
    return { label: t("provider.authenticated"), badge: null };
  }
  if (auth.status === "unauthenticated") {
    return { label: t("sourceControl.notAuthenticated"), badge: "secondary" };
  }
  return { label: t("sourceControl.statusUnknown"), badge: null };
}

function RedactedAccount(props: { readonly account: string | null }) {
  const t = useTranslate();
  return (
    <RedactedSensitiveText
      value={props.account}
      ariaLabel={t("sourceControl.accountVisibility")}
      revealTooltip={t("chat.account.reveal")}
      hideTooltip={t("chat.account.hide")}
    />
  );
}

function itemStatusDot(item: VcsDiscoveryItem | SourceControlProviderDiscoveryItem): string {
  if (isVcsNotReady(item)) return "bg-muted-foreground/35";
  if (isProviderDiscoveryItem(item)) {
    return item.status === "available" && item.auth.status === "authenticated"
      ? "bg-success"
      : "bg-muted-foreground/35";
  }
  if (item.status !== "available") return "bg-warning";
  return "bg-success";
}

function sourceControlItemIcon(
  item: VcsDiscoveryItem | SourceControlProviderDiscoveryItem,
): ReactNode {
  const host = isProviderDiscoveryItem(item) ? sourceControlClients.find(item.kind) : undefined;
  const Icon = isProviderDiscoveryItem(item)
    ? host && sourceControlIcon(host)
    : VCS_ICONS[item.kind];
  return Icon ? <Icon className="size-4.5 text-foreground/80" aria-hidden /> : null;
}

function SourceControlItemMark({
  item,
}: {
  readonly item: VcsDiscoveryItem | SourceControlProviderDiscoveryItem;
}) {
  const dotClassName = itemStatusDot(item);
  const icon = sourceControlItemIcon(item);

  if (!icon) {
    return <span className={cn("size-2 shrink-0 rounded-full", dotClassName)} aria-hidden />;
  }

  return (
    <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
      {icon}
      <span
        className={cn(
          "pointer-events-none absolute -left-0.5 -top-0.5 size-2 rounded-full ring-2 ring-background",
          dotClassName,
        )}
        aria-hidden
      />
    </span>
  );
}

function SourceControlItemSummary({
  item,
  auth,
  authAccount,
}: {
  readonly item: VcsDiscoveryItem | SourceControlProviderDiscoveryItem;
  readonly auth: SourceControlProviderAuth | null;
  readonly authAccount: string | null;
}) {
  const t = useTranslate();
  const installHint = t(`sourceControl.installHint.${item.kind}`, {
    defaultValue: item.installHint,
  });
  if (isVcsNotReady(item)) {
    return <span>{t("sourceControl.supportComing", { label: item.label })}</span>;
  }

  if (item.status !== "available") {
    return <span>{t("sourceControl.notAvailable", { hint: installHint })}</span>;
  }

  if (auth) {
    if (auth.status === "authenticated") {
      // The server names the account its requests use, Settings choice included, and
      // says when an environment token overrides it.
      const authDetail = translatedAuthDetail(auth.detail, t);
      return (
        <>
          {authAccount ? (
            <Trans
              t={t}
              i18nKey="sourceControl.authenticatedAccount"
              components={{ account: <RedactedAccount account={authAccount} /> }}
            />
          ) : (
            <span>{t("provider.authenticated")}</span>
          )}
          {authDetail ? <span>· {authDetail}</span> : null}
        </>
      );
    }

    if (!item.executable && auth.status === "unauthenticated") {
      return <span>{t("sourceControl.availableHint", { hint: installHint })}</span>;
    }

    if (auth.status === "unauthenticated" && auth.accounts?.some((entry) => entry.authenticated)) {
      return (
        <span>
          {translatedAuthDetail(auth.detail, t) ??
            t("sourceControl.allHostsOff", { label: item.label })}
        </span>
      );
    }

    if (auth.status === "unauthenticated") {
      return (
        <span>
          <Trans
            t={t}
            i18nKey="sourceControl.signInHint"
            values={{ label: item.label, executable: item.executable }}
            components={{ command: <code className="rounded bg-muted px-1 py-px text-2xs" /> }}
          />
        </span>
      );
    }
    const authDetail = translatedAuthDetail(auth.detail, t);
    return (
      <span>
        {t("sourceControl.couldNotVerify", {
          label: item.label,
          detail: authDetail ?? installHint,
        })}
      </span>
    );
  }

  return <span>{t("provider.available")}</span>;
}

function DiscoveryItemRow({
  item,
  children,
}: {
  readonly item: VcsDiscoveryItem | SourceControlProviderDiscoveryItem;
  readonly children?: ReactNode;
}) {
  const t = useTranslate();
  const version = optionLabel(item.version);
  const enabled = isProviderDiscoveryItem(item)
    ? item.status === "available" && item.auth.status === "authenticated"
    : item.status === "available" && item.implemented;
  const auth = isProviderDiscoveryItem(item) ? item.auth : null;
  const authStatus = auth ? authPresentation(auth, t) : null;
  const authAccount = auth ? optionLabel(auth.account) : null;
  const [isExpanded, setIsExpanded] = useState(false);
  const hasDetails = children !== undefined;
  const searchTargetId = useSettingsSearchTargetId();
  const [seenSearchTargetId, setSeenSearchTargetId] = useState<string | null>(null);
  const targetsThisRow = searchTargetId === sourceControlHostSettingsSearchId(item.kind);
  if (targetsThisRow && !isExpanded && seenSearchTargetId !== searchTargetId) {
    setIsExpanded(true);
  }
  if (seenSearchTargetId !== searchTargetId) setSeenSearchTargetId(searchTargetId);

  return (
    <div
      className={cn(
        "first:rounded-t-xl last:rounded-b-xl transition-colors hover:bg-muted/20",
        isVcsNotReady(item) && "opacity-80",
      )}
    >
      <div className="px-3 py-3 sm:px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SourceControlItemMark item={item} />
              <span className="truncate text-sm font-medium text-foreground">{item.label}</span>
              {version ? <code className="text-xs text-muted-foreground">{version}</code> : null}
              {isVcsNotReady(item) ? (
                <Badge variant="warning" size="sm">
                  {t("sourceControl.comingSoon")}
                </Badge>
              ) : null}
              {authStatus?.badge ? (
                <Badge variant={authStatus.badge} size="sm">
                  {authStatus.label}
                </Badge>
              ) : null}
            </div>
            <p className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs leading-normal text-muted-foreground/80">
              <SourceControlItemSummary item={item} auth={auth} authAccount={authAccount} />
            </p>
          </div>
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            {hasDetails ? (
              <Button
                size="icon-xs"
                variant="ghost-muted"
                onClick={() => setIsExpanded((open) => !open)}
                aria-expanded={isExpanded}
                aria-label={t("sourceControl.toggleDetails", { label: item.label })}
              >
                <ChevronDownIcon
                  className={cn("size-3.5 transition-transform", isExpanded && "rotate-180")}
                />
              </Button>
            ) : null}
            {!isVcsNotReady(item) ? (
              <Switch
                checked={enabled}
                disabled
                aria-label={t("sourceControl.availability", { label: item.label })}
              />
            ) : null}
          </div>
        </div>
      </div>

      {hasDetails ? (
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CollapsibleContent>
            <div className="px-3 pb-4 pt-1 sm:px-4">{children}</div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

function SourceControlSectionSkeleton({
  title,
  headerAction,
}: {
  readonly title: string;
  readonly headerAction?: ReactNode;
}) {
  return (
    <SettingsSection title={title} headerAction={headerAction}>
      {SOURCE_CONTROL_SKELETON_ROWS.map((row) => (
        <div key={row} className="first:rounded-t-xl last:rounded-b-xl px-3 py-3 sm:px-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
                  <Skeleton className="size-4.5" />
                  <Skeleton
                    shape="pill"
                    className="pointer-events-none absolute -left-0.5 -top-0.5 size-2"
                    aria-hidden
                  />
                </span>
                <Skeleton shape="pill" className="h-4 w-28" />
                <Skeleton shape="pill" className="h-5 w-14" />
              </div>
              <Skeleton shape="pill" className="h-3 w-full max-w-xs" />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Skeleton className="size-7" />
              <Skeleton shape="pill" className="h-5 w-9" />
            </div>
          </div>
        </div>
      ))}
    </SettingsSection>
  );
}

function EmptySourceControlDiscovery({
  error,
  isPending,
  onScan,
}: {
  readonly error: string | null;
  readonly isPending: boolean;
  readonly onScan: () => void;
}) {
  const t = useTranslate();
  const hasError = error !== null;

  return (
    <SettingsSection
      id={searchableSetting("source-control").id}
      title={t("sourceControl.serverEnvironment")}
    >
      <Empty>
        <EmptyMedia variant="icon">
          <PullRequestGlyph.pullRequest />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>
            {hasError ? t("sourceControl.scanFailed") : t("sourceControl.nothingDetected")}
          </EmptyTitle>
          <EmptyDescription>{hasError ? error : t("sourceControl.emptyHint")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" variant="outline" onClick={onScan} disabled={isPending}>
            <RefreshIcon size="sm" refreshing={isPending} />
            {t("sourceControl.scan")}
          </Button>
        </EmptyContent>
      </Empty>
    </SettingsSection>
  );
}

export function SourceControlSettingsPanel() {
  const t = useTranslate();
  const { scope, environment, connectedEnvironments } = useSettingsScope();

  const environmentId =
    environment?.connection.phase === "connected" ? environment.environmentId : null;
  const aggregate = scope.environmentIds.length !== 1 && connectedEnvironments.length > 1;
  const environmentSuffix = aggregate && environment ? ` · ${environment.label}` : "";
  const discovery = useEnvironmentQuery(
    environmentId === null
      ? null
      : sourceControlEnvironment.discovery({
          environmentId,
          input: {},
        }),
  );
  const result = discovery.data ?? EMPTY_DISCOVERY_RESULT;
  const hasVersionControlSystems = result.versionControlSystems.length > 0;
  const hasDiscoveryItems = hasVersionControlSystems || result.sourceControlProviders.length > 0;
  const isInitialScanPending = discovery.isPending && discovery.data === null;
  const handleScan = () => {
    discovery.refresh();
  };
  const hostSettingsPanel = (item: SourceControlProviderDiscoveryItem) => {
    const definition = sourceControlClients.find(item.kind);
    if (!definition?.settings || environmentId === null) return undefined;
    const { credentials } = definition;
    if (credentials) {
      return (
        <SettingsSearchTarget id={sourceControlHostSettingsSearchId(item.kind)}>
          <div className="grid gap-6">
            {credentials.appSignIn && item.appSignIn === true ? (
              <SourceControlAppSignInSettings
                key={`sign-in-${environmentId}`}
                environmentId={environmentId}
                definition={definition}
                appSignIn={credentials.appSignIn}
                account={Option.getOrNull(item.auth.account)}
                onChanged={handleScan}
              />
            ) : null}
            {credentials.appSignIn && item.appSignIn === true ? (
              <div className="flex items-center gap-3 text-2xs text-muted-foreground">
                <span aria-hidden className="h-px flex-1 bg-border" />
                Or use your own credentials
                <span aria-hidden className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <SourceControlTokenSettings
              key={`token-${environmentId}`}
              environmentId={environmentId}
              definition={definition}
              credentials={credentials}
              onSaved={handleScan}
            />
            {item.status === "available" ? (
              <SourceControlAccountSettings
                key={environmentId}
                environmentId={environmentId}
                definition={definition}
                credentials={credentials}
                auth={item.auth}
                onSaved={handleScan}
              />
            ) : null}
          </div>
        </SettingsSearchTarget>
      );
    }
    return (
      <SettingsSearchTarget id={sourceControlHostSettingsSearchId(item.kind)}>
        <SourceControlHostSettings
          key={environmentId}
          environmentId={environmentId}
          definition={{ ...definition, settings: definition.settings }}
          onSaved={handleScan}
        />
      </SettingsSearchTarget>
    );
  };
  const scanButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            onClick={handleScan}
            disabled={discovery.isPending}
            aria-label={t("sourceControl.rescan")}
          >
            <RefreshIcon refreshing={discovery.isPending} />
          </Button>
        }
      />
      <TooltipPopup side="top">{t("sourceControl.rescanHint")}</TooltipPopup>
    </Tooltip>
  );

  return (
    <SettingsPageContainer>
      <ProjectDefaultsSettings category="source-control" />
      {environmentId === null ? (
        <SettingsSection
          id={searchableSetting("source-control").id}
          title={t("sourceControl.serverEnvironment")}
        >
          <p className="px-4 py-3 text-sm text-muted-foreground">
            {t("sourceControl.connectHint")}
          </p>
        </SettingsSection>
      ) : isInitialScanPending ? (
        <>
          <SourceControlSectionSkeleton
            title={t("sourceControl.versionControl", { suffix: environmentSuffix })}
            headerAction={scanButton}
          />
          <SourceControlSectionSkeleton title={t("sourceControl.providers", { suffix: "" })} />
        </>
      ) : hasDiscoveryItems ? (
        <>
          {hasVersionControlSystems ? (
            <SettingsSection
              id={searchableSetting("source-control").id}
              title={t("sourceControl.versionControl", { suffix: environmentSuffix })}
              headerAction={scanButton}
            >
              {result.versionControlSystems.map((item) => (
                <DiscoveryItemRow key={`vcs:${item.kind}`} item={item} />
              ))}
            </SettingsSection>
          ) : null}

          {result.sourceControlProviders.length > 0 ? (
            <SettingsSection
              id={hasVersionControlSystems ? undefined : searchableSetting("source-control").id}
              title={
                hasVersionControlSystems
                  ? t("sourceControl.providers", { suffix: "" })
                  : t("sourceControl.providers", { suffix: environmentSuffix })
              }
              headerAction={hasVersionControlSystems ? null : scanButton}
            >
              {result.sourceControlProviders.map((item) => (
                <DiscoveryItemRow key={`provider:${item.kind}`} item={item}>
                  {hostSettingsPanel(item)}
                </DiscoveryItemRow>
              ))}
            </SettingsSection>
          ) : null}
        </>
      ) : (
        <EmptySourceControlDiscovery
          error={discovery.error}
          isPending={discovery.isPending}
          onScan={handleScan}
        />
      )}

      <SourceControlWritingSettingsSection />
    </SettingsPageContainer>
  );
}
