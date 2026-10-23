import {
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  isLanguagePreference,
} from "@t3tools/client-runtime/i18n";
import { showDesktopUpdateErrorToast } from "../desktopUpdate.toast";
import { i18n, useTranslate } from "../../i18n";
import { AboutVersionTitle } from "./AboutVersionTitle";
import { shouldToastDesktopUpdateActionResult } from "../desktopUpdate.logic";

import { NotificationSettings } from "./NotificationSettings";
import { CheckIcon } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  type DesktopUpdateChannel,
  IDLE_COMPACTION_MODES,
  globalIdleCompaction,
  ProviderDriverKind,
  type ProviderInstanceId,
  type SidebarProjectGroupingMode,
} from "@t3tools/contracts";
import {
  DEFAULT_UNIFIED_SETTINGS,
  type DiffLayout,
  MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  type ResponseStreamingMode,
  type QuitConfirmationMode,
} from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import * as Equal from "effect/Equal";

import { HOSTED_APP_CHANNEL } from "../../branding";
import { CliCommandSettingsRow } from "./CliCommandSettingsRow";
import { MobileAppSettingsRow } from "./MobileAppSettingsRow";
import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateDisabledReason,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "../../components/desktopUpdate.logic";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { isElectron } from "../../env";
import { buildHostedChannelSelectionUrl, type HostedAppChannel } from "../../hostedPairing";
import {
  readAppearanceModePreference,
  readThemeHalves,
  readThemePreference,
  useTheme,
} from "../../hooks/useTheme";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useSettingsScope } from "./SettingsScopeContext";
import { scopedIdleCompaction } from "./scopedSettings";
import { ProjectDefaultsSettings } from "./ProjectDefaultsSettings";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
  selectsPlanAgent,
} from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import { isMacPlatform } from "../../lib/utils";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { Button } from "../ui/button";

import { DraftInput } from "../ui/draft-input";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { ScopedSwitch } from "./ScopedSwitch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  getChangedBrowserSettingLabels,
  getChangedTypographySettingLabels,
  hasChangedBackgroundActivitySettings,
  isProjectGroupingEnabled,
  projectGroupingModeFromToggle,
  readLastEnabledProjectGroupingMode,
  rememberEnabledProjectGroupingMode,
} from "./SettingsPanels.logic";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { BackgroundActivitySettingsRow } from "./BackgroundActivitySettings";

const RESPONSE_STREAMING_MODE_LABELS: Record<ResponseStreamingMode, string> = {
  turn: "options.streaming.turn",
  paragraph: "options.streaming.paragraph",
};

const RESPONSE_STREAMING_MODE_DESCRIPTIONS: Record<ResponseStreamingMode, string> = {
  turn: "options.streamingDescription.turn",
  paragraph: "options.streamingDescription.paragraph",
};

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

const DIFF_LAYOUT_LABELS: Record<DiffLayout, string> = {
  stacked: "options.diffLayout.stacked",
  split: "options.diffLayout.split",
};

const QUIT_CONFIRMATION_MODE_LABELS: Record<QuitConfirmationMode, string> = {
  direct: "options.quit.direct",
  hold: "options.quit.hold",
  "double-click": "options.quit.double-click",
};

const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");
function AboutVersionSection() {
  const t = useTranslate();
  const updateState = useDesktopUpdateState();
  const [isChangingUpdateChannel, setIsChangingUpdateChannel] = useState(false);
  const [isUpdateActionPending, setIsUpdateActionPending] = useState(false);

  const hasDesktopBridge = typeof window !== "undefined" && Boolean(window.desktopBridge);
  const selectedUpdateChannel = updateState?.channel ?? "latest";
  const selectedHostedAppChannel = hasDesktopBridge ? null : HOSTED_APP_CHANNEL;

  const handleUpdateChannelChange = (channel: DesktopUpdateChannel) => {
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.setUpdateChannel !== "function" ||
      channel === selectedUpdateChannel
    ) {
      return;
    }

    setIsChangingUpdateChannel(true);
    void bridge
      .setUpdateChannel(channel)
      .catch((error: unknown) => {
        showDesktopUpdateErrorToast(
          "about.updateTrack.error",
          error instanceof Error ? error.message : null,
          "about.updateTrack.failed",
        );
      })
      .finally(() => {
        setIsChangingUpdateChannel(false);
      });
  };

  const handleButtonClick = async () => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";

    if (action === "download" || action === "open-download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.state.convene && shouldToastDesktopUpdateActionResult(result)) {
            showDesktopUpdateErrorToast(
              "about.updateDownload.error",
              result.state.message,
              "about.updateDownload.failed",
            );
          }
        })
        .catch((error: unknown) => {
          showDesktopUpdateErrorToast(
            "about.updateDownload.error",
            error instanceof Error ? error.message : null,
            "about.updateDownload.failed",
          );
        });
      return;
    }

    if (action === "install") {
      if (isUpdateActionPending) return;
      setIsUpdateActionPending(true);
      let confirmed = false;
      try {
        confirmed = await ensureLocalApi().dialogs.confirm(
          getDesktopUpdateInstallConfirmationMessage(
            updateState ?? { availableVersion: null, downloadedVersion: null },
            t,
          ),
        );
      } catch (error) {
        setIsUpdateActionPending(false);
        showDesktopUpdateErrorToast(
          "about.updateConfirm.error",
          error instanceof Error ? error.message : null,
          "about.updateConfirm.failed",
        );
        return;
      }
      if (!confirmed) {
        setIsUpdateActionPending(false);
        return;
      }
      void bridge
        .installUpdate()
        .catch((error: unknown) => {
          showDesktopUpdateErrorToast(
            "about.updateInstall.error",
            error instanceof Error ? error.message : null,
            "about.updateInstall.failed",
          );
        })
        .finally(() => setIsUpdateActionPending(false));
      return;
    }

    if (typeof bridge.checkForUpdate !== "function") return;
    void bridge
      .checkForUpdate()
      .then((result) => {
        if (!result.checked) {
          showDesktopUpdateErrorToast(
            "about.updateCheck.error",
            result.state.message,
            "about.updateUnsupported",
          );
        }
      })
      .catch((error: unknown) => {
        showDesktopUpdateErrorToast(
          "about.updateCheck.error",
          error instanceof Error ? error.message : null,
          "about.updateCheck.failed",
        );
      });
  };

  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  const buttonTooltip = updateState ? getDesktopUpdateButtonTooltip(updateState, t) : null;
  const buttonDisabled =
    action === "none"
      ? !canCheckForUpdate(updateState)
      : isDesktopUpdateButtonDisabled(updateState);

  const actionLabel: Record<string, string> = {
    "open-download": t("update.platform.download"),
    download: t("about.download"),
    install: t("about.install"),
  };
  const statusLabel: Record<string, string> = {
    checking: t("about.checking"),
    downloading: t("about.downloading"),
    "up-to-date": t("about.upToDate"),
  };
  const buttonLabel =
    actionLabel[action] ?? statusLabel[updateState?.status ?? ""] ?? t("about.updateCheck");
  const platformDownloadsUrl = updateState?.convene?.downloadsUrl;
  const description = updateState?.convene
    ? getDesktopUpdateButtonTooltip(updateState, t)
    : action === "download" || action === "install"
      ? t("about.updateAvailable")
      : (getDesktopUpdateDisabledReason(updateState) ?? t("about.version.description"));

  return (
    <>
      <SettingsRow
        id={searchableSetting("app-version").id}
        title={<AboutVersionTitle />}
        description={description}
        control={
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={buttonDisabled || isUpdateActionPending}
                  onClick={handleButtonClick}
                >
                  {buttonLabel}
                </Button>
              }
            />
            {buttonTooltip ? <TooltipPopup>{buttonTooltip}</TooltipPopup> : null}
          </Tooltip>
        }
      />
      {updateState?.convene ? (
        <SettingsRow
          title={t("update.platform.source")}
          description={
            <div className="space-y-1 break-all">
              <p>{updateState.convene.baseUrl ?? t("update.platform.connectFirst")}</p>
              {updateState.convene.releaseVersion ? (
                <p>
                  {t("update.platform.publishedVersion", {
                    version: updateState.convene.releaseVersion,
                  })}
                </p>
              ) : null}
              {updateState.checkedAt ? (
                <p>
                  {t("update.platform.checkedAt", {
                    date: new Date(updateState.checkedAt).toLocaleString(),
                  })}
                </p>
              ) : null}
            </div>
          }
          control={
            platformDownloadsUrl ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void window.desktopBridge?.openExternal(platformDownloadsUrl);
                }}
              >
                {t("update.platform.downloads")}
              </Button>
            ) : null
          }
        />
      ) : hasDesktopBridge ? (
        <SettingsRow
          {...searchableSetting("update-track", t)}
          title={t("about.updateTrack")}
          description={t("about.updateTrack.description")}
          control={
            <Select
              value={selectedUpdateChannel}
              onValueChange={(value) => {
                handleUpdateChannelChange(value as DesktopUpdateChannel);
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("about.updateTrack")}
                disabled={isChangingUpdateChannel}
              >
                <SelectValue>
                  {selectedUpdateChannel === "nightly" ? t("about.nightly") : t("about.stable")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  {t("about.stable")}
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  {t("about.nightly")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : selectedHostedAppChannel ? (
        <SettingsRow
          {...searchableSetting("update-track", t)}
          title={t("about.updateTrack")}
          description={t("about.updateTrack.hosted")}
          control={
            <Select
              value={selectedHostedAppChannel}
              onValueChange={(value) => {
                if (value === selectedHostedAppChannel) return;
                window.location.assign(
                  buildHostedChannelSelectionUrl({ channel: value as HostedAppChannel }),
                );
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("about.updateTrack")}
              >
                <SelectValue>
                  {selectedHostedAppChannel === "nightly" ? t("about.nightly") : t("about.latest")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  {t("about.latest")}
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  {t("about.nightly")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : null}
      {hasDesktopBridge ? <CliCommandSettingsRow /> : null}
    </>
  );
}

export function useSettingsRestore(onRestored?: () => void) {
  const t = useTranslate();
  const {
    theme,
    setTheme,
    followSystem,
    setFollowSystem,
    setThemeHalf,
    clearThemeHalves,
    themeHalves,
  } = useTheme();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const isBackgroundActivityDirty = hasChangedBackgroundActivitySettings(settings);

  const changedSettingLabels = [
    ...(settings.languagePreference !== DEFAULT_UNIFIED_SETTINGS.languagePreference
      ? [t("settings.language.title")]
      : []),
    ...(theme !== "system" ? [t("restore.theme")] : []),
    ...(!followSystem ? [t("restore.followSystem")] : []),
    ...(themeHalves !== null ? [t("restore.themeMix")] : []),
    ...(settings.appearanceContrast !== DEFAULT_UNIFIED_SETTINGS.appearanceContrast
      ? [t("settings.search.setting-appearance-contrast.title")]
      : []),
    ...(settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity
      ? [t("settings.search.setting-glass-opacity.title")]
      : []),
    ...(settings.diffColorScheme !== DEFAULT_UNIFIED_SETTINGS.diffColorScheme
      ? [t("settings.search.diff-color-scheme.title")]
      : []),
    ...(settings.chatWidth !== DEFAULT_UNIFIED_SETTINGS.chatWidth
      ? [t("settings.search.chat-width.title")]
      : []),
    ...(settings.mathRenderingEnabled !== DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled
      ? [t("settings.search.math-rendering.title")]
      : []),
    ...(settings.panelAnimationDurationMs !== DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs
      ? [t("settings.search.panel-animations.title")]
      : []),
    ...(settings.environmentIdentificationMode !==
    DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode
      ? [t("settings.search.environment-identification.title")]
      : []),
    ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
      ? [t("settings.search.time-format.title")]
      : []),
    ...(settings.notificationMode !== DEFAULT_UNIFIED_SETTINGS.notificationMode
      ? [t("settings.search.thread-notifications.title")]
      : []),
    ...(settings.inAppNotificationsEnabled !== DEFAULT_UNIFIED_SETTINGS.inAppNotificationsEnabled
      ? [t("settings.search.in-app-notifications.title")]
      : []),
    ...(settings.sidebarThreadPreviewCount !== DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount
      ? [t("restore.visibleThreads")]
      : []),
    ...(settings.sidebarProjectGroupingMode !== DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode
      ? [t("settings.search.project-grouping.title")]
      : []),
    ...(settings.sidebarWorkingShelfEnabled !== DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled
      ? [t("general.working.label")]
      : []),
    ...(settings.compactIdleThreads !== DEFAULT_UNIFIED_SETTINGS.compactIdleThreads
      ? [t("settings.search.compact-idle-threads.title")]
      : []),
    ...(settings.sidebarAutoSettleAfterDays !== DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays
      ? [t("settings.search.auto-settle-inactive-threads.title")]
      : []),
    ...(settings.sidebarAutoSettleKeepPullRequests !==
    DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleKeepPullRequests
      ? [t("settings.search.keep-threads-with-pr.title")]
      : []),
    ...(settings.sidebarAutoSettleOnMerge !== DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge
      ? [t("general.settleMerge.label")]
      : []),
    ...(settings.autoResumeLimitedThreads !== DEFAULT_UNIFIED_SETTINGS.autoResumeLimitedThreads
      ? [t("general.autoResume.label")]
      : []),
    ...(settings.snoozeLimitedThreads !== DEFAULT_UNIFIED_SETTINGS.snoozeLimitedThreads
      ? [t("general.snooze.label")]
      : []),
    ...(settings.wordWrap !== DEFAULT_UNIFIED_SETTINGS.wordWrap
      ? [t("settings.search.word-wrap.title")]
      : []),
    ...(settings.persistComposerContextStrip !==
    DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip
      ? [t("restore.composerContext")]
      : []),
    ...getChangedTypographySettingLabels(settings),
    ...(settings.diffFilesCollapsed !== DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed
      ? [t("general.diffFiles.label")]
      : []),
    ...(settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace
      ? [t("general.whitespace.label")]
      : []),
    ...(settings.diffLayout !== DEFAULT_UNIFIED_SETTINGS.diffLayout
      ? [t("general.diffLayout.label")]
      : []),
    ...(settings.proactivePanelsEnabled !== DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled
      ? [t("general.proactive.label")]
      : []),
    ...(settings.showSkillsInSlashMenu !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu
      ? [t("general.skills.label")]
      : []),
    ...(settings.composerCollapseOnScroll !== DEFAULT_UNIFIED_SETTINGS.composerCollapseOnScroll
      ? [t("general.collapse.label")]
      : []),
    ...(settings.composerRichTextEnabled !== DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled
      ? [t("general.richText.label")]
      : []),
    ...(settings.sendShortcut !== DEFAULT_UNIFIED_SETTINGS.sendShortcut
      ? [t("general.send.label")]
      : []),
    ...(settings.followUpBehavior !== DEFAULT_UNIFIED_SETTINGS.followUpBehavior
      ? [t("general.followUp.label")]
      : []),
    ...(settings.contextWindowMeterEnabled !== DEFAULT_UNIFIED_SETTINGS.contextWindowMeterEnabled
      ? [t("restore.contextWindow")]
      : []),
    ...(settings.responseStreamingMode !== DEFAULT_UNIFIED_SETTINGS.responseStreamingMode
      ? [t("general.streaming.label")]
      : []),
    ...(settings.enableProviderUpdateChecks !== DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks
      ? [t("settings.search.provider-update-checks.title")]
      : []),
    ...(settings.continueThreadsAfterServerUpdate !==
    DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate
      ? [t("general.restart.label")]
      : []),
    ...(isBackgroundActivityDirty ? [t("settings.search.background-activity.title")] : []),
    ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
      ? [t("restore.newThreadMode")]
      : []),
    ...(settings.newWorktreesStartFromOrigin !==
    DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin
      ? [t("restore.newWorktreesRemote")]
      : []),
    ...(settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
      ? [t("general.baseDirectory.label")]
      : []),
    ...(settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin
      ? [t("settings.search.unpin-confirmation.title")]
      : []),
    ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
      ? [t("settings.search.archive-confirmation.title")]
      : []),
    ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
      ? [t("settings.search.delete-confirmation.title")]
      : []),
    ...(settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit
      ? [t("settings.search.quit-confirmation.title")]
      : []),
    ...(isTextGenerationModelDirty ? [t("settings.search.text-generation-model.title")] : []),
    ...getChangedBrowserSettingLabels(settings),
    ...(settings.enableAgentBrowserAccess !== DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess
      ? [t("restore.agentBrowserAccess")]
      : []),
  ];

  const restoreDefaults = async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readLocalApi();
    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
      t("restore.confirm", {
        settings: changedSettingLabels.join(i18n.resolvedLanguage === "zh" ? "、" : ", "),
      }),
      { variant: "destructive" },
    );
    if (!confirmed) return;

    // Only touch the theme keys that are actually dirty, so a theme-storage
    // failure cannot block restoring unrelated settings. Preferences are
    // re-read after the confirmation dialog: they may have changed (another
    // tab, an OS flip) while it was open, and rollback must restore the live
    // values rather than the ones captured at render time.
    let previousTheme = theme;
    try {
      previousTheme = readThemePreference();
    } catch {}
    const liveHalves = readThemeHalves();
    const needsThemeReset = previousTheme !== "system";
    const needsMixReset = liveHalves !== null;
    const needsFollowSystemReset = readAppearanceModePreference(previousTheme) !== "system";
    const notifyThemeRestoreFailure = () => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("restore.themeFailed"),
          description: t("restore.tryAgain"),
        }),
      );
    };
    // Rollback restores the base preference first (which clears any mix) and
    // then re-applies the captured mix on top, so no failure path can leave
    // the pair of keys half-restored.
    const previousHalves = liveHalves;
    const rollbackThemeState = () => {
      if (needsThemeReset) setTheme(previousTheme);
      if (previousHalves?.light) setThemeHalf("light", previousHalves.light);
      if (previousHalves?.dark) setThemeHalf("dark", previousHalves.dark);
    };
    if (needsThemeReset && !setTheme("system")) {
      notifyThemeRestoreFailure();
      return;
    }
    if (needsMixReset && !clearThemeHalves()) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    if (needsFollowSystemReset && !setFollowSystem(true)) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    updateSettings({
      appearanceContrast: DEFAULT_UNIFIED_SETTINGS.appearanceContrast,
      diffColorScheme: DEFAULT_UNIFIED_SETTINGS.diffColorScheme,
      chatWidth: DEFAULT_UNIFIED_SETTINGS.chatWidth,
      mathRenderingEnabled: DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled,
      timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
      languagePreference: DEFAULT_UNIFIED_SETTINGS.languagePreference,
      notificationMode: DEFAULT_UNIFIED_SETTINGS.notificationMode,
      inAppNotificationsEnabled: DEFAULT_UNIFIED_SETTINGS.inAppNotificationsEnabled,
      wordWrap: DEFAULT_UNIFIED_SETTINGS.wordWrap,
      persistComposerContextStrip: DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip,
      diffFilesCollapsed: DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed,
      diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
      diffLayout: DEFAULT_UNIFIED_SETTINGS.diffLayout,
      proactivePanelsEnabled: DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled,
      showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
      composerCollapseOnScroll: DEFAULT_UNIFIED_SETTINGS.composerCollapseOnScroll,
      composerRichTextEnabled: DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled,
      sendShortcut: DEFAULT_UNIFIED_SETTINGS.sendShortcut,
      followUpBehavior: DEFAULT_UNIFIED_SETTINGS.followUpBehavior,
      contextWindowMeterEnabled: DEFAULT_UNIFIED_SETTINGS.contextWindowMeterEnabled,
      environmentIdentificationMode: DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode,
      glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity,
      panelAnimationDurationMs: DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs,
      sidebarThreadPreviewCount: DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount,
      sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
      sidebarWorkingShelfEnabled: DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled,
      compactIdleThreads: DEFAULT_UNIFIED_SETTINGS.compactIdleThreads,
      sidebarAutoSettleAfterDays: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays,
      sidebarAutoSettleKeepPullRequests: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleKeepPullRequests,
      sidebarAutoSettleOnMerge: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge,
      autoResumeLimitedThreads: DEFAULT_UNIFIED_SETTINGS.autoResumeLimitedThreads,
      snoozeLimitedThreads: DEFAULT_UNIFIED_SETTINGS.snoozeLimitedThreads,
      responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
      enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
      continueThreadsAfterServerUpdate: DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate,
      backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
      backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
      automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
      providerHealthRefreshInterval: DEFAULT_UNIFIED_SETTINGS.providerHealthRefreshInterval,
      defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
      newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
      addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
      confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
      confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
      confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
      confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit,
      textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
      fontFamilySans: DEFAULT_UNIFIED_SETTINGS.fontFamilySans,
      fontFamilyComposer: DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer,
      fontFamilyCode: DEFAULT_UNIFIED_SETTINGS.fontFamilyCode,
      fontFamilyTerminal: DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal,
      fontSizeInterface: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface,
      fontSizePrompt: DEFAULT_UNIFIED_SETTINGS.fontSizePrompt,
      fontSizeCode: DEFAULT_UNIFIED_SETTINGS.fontSizeCode,
      fontSizeTerminal: DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal,
      browserDefaultViewport: DEFAULT_UNIFIED_SETTINGS.browserDefaultViewport,
      browserDefaultZoomFactor: DEFAULT_UNIFIED_SETTINGS.browserDefaultZoomFactor,
      browserDefaultAppearance: DEFAULT_UNIFIED_SETTINGS.browserDefaultAppearance,
      browserRecordingFrameRate: DEFAULT_UNIFIED_SETTINGS.browserRecordingFrameRate,
      browserRecordingShowKeyPresses: DEFAULT_UNIFIED_SETTINGS.browserRecordingShowKeyPresses,
      browserRecordingShowMousePresses: DEFAULT_UNIFIED_SETTINGS.browserRecordingShowMousePresses,
      browserLinkTarget: DEFAULT_UNIFIED_SETTINGS.browserLinkTarget,
      browserSearchEngine: DEFAULT_UNIFIED_SETTINGS.browserSearchEngine,
      browserCustomSearchUrl: DEFAULT_UNIFIED_SETTINGS.browserCustomSearchUrl,
      browserAutoShowFloatingPreview: DEFAULT_UNIFIED_SETTINGS.browserAutoShowFloatingPreview,
      pullRequestLinksOpenInApp: DEFAULT_UNIFIED_SETTINGS.pullRequestLinksOpenInApp,
      enableAgentBrowserAccess: DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess,
    });
    onRestored?.();
  };

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

const AUTO_SETTLE_DEFAULT_DAYS = DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays ?? 3;

function AutoSettleDaysInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (days: number) => void;
}) {
  const t = useTranslate();
  // Local draft so the field can be emptied mid-edit; the setting only moves
  // on valid input and snaps back to the persisted value on blur.
  const [draft, setDraft] = useState(String(value));
  const [draftSource, setDraftSource] = useState(value);
  if (draftSource !== value) {
    setDraftSource(value);
    setDraft(String(value));
  }

  return (
    <Input
      size="sm"
      type="number"
      min={MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS}
      max={MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS}
      className="w-full sm:w-24"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        const parsed = Number(event.target.value);
        if (
          Number.isInteger(parsed) &&
          parsed >= MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS &&
          parsed <= MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS
        ) {
          onCommit(parsed);
        }
      }}
      onBlur={() => setDraft(String(value))}
      aria-label={t("general.settleInactive.days")}
    />
  );
}

export function GeneralSettingsPanel() {
  const t = useTranslate();
  const modifierLabel = isMacPlatform(navigator.platform) ? "⌘" : "Ctrl";
  const sendShortcutOptions = [
    { value: "enter", label: "Enter" },
    {
      value: "mod-enter-multiline",
      label: t("general.send.multiline", { modifier: modifierLabel }),
    },
    { value: "mod-enter", label: t("general.send.always", { modifier: modifierLabel }) },
  ] as const;
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { scope, environment, connectedEnvironments, target, targets } = useSettingsScope();
  const idleCompaction = scopedIdleCompaction(targets.length > 0 ? targets : [{ settings }]);
  const environmentId = environment?.environmentId ?? null;
  const isEnvironmentScope = scope.environmentIds.length === 1 && environmentId !== null;
  const hasServerTargets = connectedEnvironments.length > 0;
  const mixedResponseStreamingMode = useScopedSettingsMixed(["responseStreamingMode"]);
  const lastEnabledProjectGroupingMode = useRef<SidebarProjectGroupingMode>(
    readLastEnabledProjectGroupingMode(),
  );
  const providersByEnvironment = useEnvironmentProviders();
  const serverProviders =
    (environment?.serverConfig
      ? providersByEnvironment.get(environment.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const supportsAutoSettlement =
    connectedEnvironments.length > 0 &&
    connectedEnvironments.every(
      (target) => target.serverConfig?.environment.capabilities.threadAutoSettlement === true,
    );
  const supportsAutoSettlementScope = connectedEnvironments.every(
    (target) => target.serverConfig?.environment.capabilities.threadAutoSettlementScope === true,
  );
  const supportsRestartContinuation =
    connectedEnvironments.length > 0 &&
    connectedEnvironments.every(
      (target) => target.serverConfig?.environment.capabilities.threadRestartContinuation === true,
    );

  const textGenerationProviders = serverProviders.filter(
    (provider) => provider.supportsTextGeneration !== false,
  );
  const textGenerationModelSelection = resolveAppModelSelectionState(
    settings,
    textGenerationProviders,
  );
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const textGenerationModelInstanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(textGenerationProviders),
      settings,
      target?.projectId ?? null,
    ),
  );
  const hasTextGenerationProvider = textGenerationModelInstanceEntries.some(
    (entry) => entry.enabled && entry.isAvailable,
  );
  const textGenInstanceEntry = textGenerationModelInstanceEntries.find(
    (entry) => entry.instanceId === textGenInstanceId,
  );
  const textGenProvider: ProviderDriverKind =
    textGenInstanceEntry?.driverKind ?? DEFAULT_DRIVER_KIND;
  const textGenerationModelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    textGenerationProviders,
    textGenInstanceId,
    textGenModel,
  );
  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const textGenerationModelDisabledReason = useScopedModelDisabledReason(
    settings,
    textGenerationModelInstanceEntries,
  );
  const mixedAddProjectBaseDirectory = useScopedSettingsMixed(["addProjectBaseDirectory"]);
  const mixedTextGenerationModel = useScopedSettingsMixed(["textGenerationModelSelection"]);

  return (
    <SettingsPageContainer>
      <ProjectDefaultsSettings category="general" />
      <SettingsSection id="organization" title={t("section.organization")}>
        <SettingsRow
          {...searchableSetting("project-grouping", t)}
          description={t("general.projectGrouping.description")}
          resetAction={
            settings.sidebarProjectGroupingMode !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode ? (
              <SettingResetButton
                label={t("general.projectGrouping.reset")}
                onClick={() =>
                  updateSettings({
                    sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={isProjectGroupingEnabled(settings.sidebarProjectGroupingMode)}
              onCheckedChange={(checked) => {
                if (!checked && settings.sidebarProjectGroupingMode !== "separate") {
                  lastEnabledProjectGroupingMode.current = settings.sidebarProjectGroupingMode;
                  rememberEnabledProjectGroupingMode(settings.sidebarProjectGroupingMode);
                }
                updateSettings({
                  sidebarProjectGroupingMode: projectGroupingModeFromToggle(
                    checked,
                    lastEnabledProjectGroupingMode.current,
                  ),
                });
              }}
              aria-label={t("general.projectGrouping.label")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("project-order", t)}
          description={t("general.projectOrder.stableDescription")}
        />

        <SettingsRow
          serverScoped
          {...searchableSetting("auto-resume-limited-threads", t)}
          description={t("general.autoResume.description")}
          settingKeys={["autoResumeLimitedThreads"]}
          control={
            <ScopedSwitch
              settingKeys={["autoResumeLimitedThreads"]}
              checked={settings.autoResumeLimitedThreads}
              onCheckedChange={(checked) =>
                updateSettings({ autoResumeLimitedThreads: Boolean(checked) })
              }
              aria-label={t("general.autoResume.label")}
            />
          }
        />
        <SettingsRow
          serverScoped
          {...searchableSetting("snooze-limited-threads", t)}
          description={t("general.snooze.description")}
          settingKeys={["snoozeLimitedThreads"]}
          control={
            <ScopedSwitch
              settingKeys={["snoozeLimitedThreads"]}
              checked={settings.snoozeLimitedThreads}
              onCheckedChange={(checked) =>
                updateSettings({ snoozeLimitedThreads: Boolean(checked) })
              }
              aria-label={t("general.snooze.label")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("working-shelf", t)}
          description={t("general.working.description")}
          resetAction={
            settings.sidebarWorkingShelfEnabled !==
            DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled ? (
              <SettingResetButton
                label={t("general.working.reset")}
                onClick={() =>
                  updateSettings({
                    sidebarWorkingShelfEnabled: DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.sidebarWorkingShelfEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ sidebarWorkingShelfEnabled: Boolean(checked) })
              }
              aria-label={t("general.working.label")}
            />
          }
        />

        <SettingsRow
          serverScoped
          settingKeys={["idleCompaction", "compactIdleThreads"]}
          mixed={idleCompaction.mixed}
          {...searchableSetting("compact-idle-threads")}
          description={t("general.compactIdle.description")}
          resetAction={
            globalIdleCompaction(settings) !== globalIdleCompaction(DEFAULT_UNIFIED_SETTINGS) ? (
              <SettingResetButton
                label={t("general.compactIdle.reset")}
                onClick={() =>
                  updateSettings({ idleCompaction: globalIdleCompaction(DEFAULT_UNIFIED_SETTINGS) })
                }
              />
            ) : null
          }
          control={
            <Select
              value={idleCompaction.mixed ? null : globalIdleCompaction(settings)}
              onValueChange={(value) => {
                const mode = IDLE_COMPACTION_MODES.find((candidate) => candidate.value === value);
                if (mode) updateSettings({ idleCompaction: mode.value });
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Compact idle threads">
                <SelectValue>
                  {(value: string | null) =>
                    value === null ? "Mixed" : t(`general.compactIdle.${value}`)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {IDLE_COMPACTION_MODES.map((mode) => (
                  <SelectItem
                    hideIndicator
                    key={mode.value}
                    value={mode.value}
                    // A server from before modes has only the on/off switch, so it cannot store "Never".
                    disabled={mode.value === "off" && !idleCompaction.neverAvailable}
                  >
                    {t(`general.compactIdle.${mode.value}`)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        {supportsAutoSettlement ? (
          <>
            <SettingsRow
              serverScoped
              settingKeys={["sidebarAutoSettleOnMerge"]}
              {...searchableSetting("auto-settle-merged-threads", t)}
              description={t("general.settleMerge.description")}
              resetAction={
                settings.sidebarAutoSettleOnMerge !==
                DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge ? (
                  <SettingResetButton
                    label={t("general.settleMerge.reset")}
                    onClick={() =>
                      updateSettings({
                        sidebarAutoSettleOnMerge: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge,
                      })
                    }
                  />
                ) : null
              }
              control={
                <ScopedSwitch
                  settingKeys={["sidebarAutoSettleOnMerge"]}
                  checked={settings.sidebarAutoSettleOnMerge}
                  onCheckedChange={(checked) =>
                    updateSettings({ sidebarAutoSettleOnMerge: Boolean(checked) })
                  }
                  aria-label={t("general.settleMerge.label")}
                />
              }
            />

            <SettingsRow
              serverScoped
              settingKeys={["sidebarAutoSettleAfterDays"]}
              {...searchableSetting("auto-settle-inactive-threads", t)}
              description={t("general.settleInactive.description")}
              resetAction={
                settings.sidebarAutoSettleAfterDays !==
                DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays ? (
                  <SettingResetButton
                    label={t("general.settleInactive.reset")}
                    onClick={() =>
                      updateSettings({
                        sidebarAutoSettleAfterDays:
                          DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays,
                      })
                    }
                  />
                ) : null
              }
              control={
                <ScopedSwitch
                  settingKeys={["sidebarAutoSettleAfterDays"]}
                  checked={settings.sidebarAutoSettleAfterDays !== null}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      sidebarAutoSettleAfterDays: checked ? AUTO_SETTLE_DEFAULT_DAYS : null,
                    })
                  }
                  aria-label={t("general.settleInactive.label")}
                />
              }
            />
            {settings.sidebarAutoSettleAfterDays !== null ? (
              <SettingsRow
                serverScoped
                settingKeys={["sidebarAutoSettleAfterDays"]}
                title={searchableSetting("days-before-auto-settle", t).title}
                description={t("general.settleInactive.note")}
                control={
                  <AutoSettleDaysInput
                    value={settings.sidebarAutoSettleAfterDays}
                    onCommit={(days) => updateSettings({ sidebarAutoSettleAfterDays: days })}
                  />
                }
              />
            ) : null}
            {settings.sidebarAutoSettleAfterDays !== null && supportsAutoSettlementScope ? (
              <SettingsRow
                serverScoped
                settingKeys={["sidebarAutoSettleKeepPullRequests"]}
                {...searchableSetting("keep-threads-with-pr", t)}
                description={t("general.keepPr.description")}
                control={
                  <ScopedSwitch
                    settingKeys={["sidebarAutoSettleKeepPullRequests"]}
                    checked={settings.sidebarAutoSettleKeepPullRequests}
                    onCheckedChange={(checked) =>
                      updateSettings({ sidebarAutoSettleKeepPullRequests: checked })
                    }
                    aria-label={t("settings.search.keep-threads-with-pr.title")}
                  />
                }
              />
            ) : null}
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection id="behavior" title={t("section.behavior")}>
        <SettingsRow
          {...searchableSetting("plan-mode", t)}
          description={t("general.plan.description")}
          control={
            <Switch
              checked={settings.planModeEnabled}
              onCheckedChange={(checked) => {
                updateSettings({ planModeEnabled: Boolean(checked) });
              }}
              aria-label={t("general.plan.title")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("context-window-indicator", t)}
          description={t("general.context.description")}
          control={
            <Switch
              checked={settings.contextWindowMeterEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ contextWindowMeterEnabled: Boolean(checked) })
              }
              aria-label={t("general.context.title")}
            />
          }
        />
        <NotificationSettings />
        <SettingsRow
          {...searchableSetting("in-app-notifications", t)}
          description={t("general.inAppNotifications.description")}
          control={
            <Switch
              checked={settings.inAppNotificationsEnabled}
              onCheckedChange={(checked) => updateSettings({ inAppNotificationsEnabled: checked })}
              aria-label={t("general.inAppNotifications.label")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("time-format", t)}
          description={t("general.time.description")}
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label={t("general.time.reset")}
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("general.time.label")}
              >
                <SelectValue>{t(TIMESTAMP_FORMAT_LABELS[settings.timestampFormat])}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {t(TIMESTAMP_FORMAT_LABELS.locale)}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {t(TIMESTAMP_FORMAT_LABELS["12-hour"])}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {t(TIMESTAMP_FORMAT_LABELS["24-hour"])}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("language", t)}
          // The search index supplies the English title every other row uses;
          // this row is new, so it overrides that with a translated one and
          // stays consistent with its own translated description and value.
          title={t("settings.language.title")}
          description={t("settings.language.description")}
          resetAction={
            settings.languagePreference !== DEFAULT_UNIFIED_SETTINGS.languagePreference ? (
              <SettingResetButton
                label={t("settings.language.title")}
                onClick={() =>
                  updateSettings({
                    languagePreference: DEFAULT_UNIFIED_SETTINGS.languagePreference,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.languagePreference}
              onValueChange={(value) => {
                if (isLanguagePreference(value)) {
                  updateSettings({ languagePreference: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("settings.language.title")}
              >
                <SelectValue>
                  {settings.languagePreference === "system"
                    ? t("settings.language.system")
                    : LANGUAGE_LABELS[settings.languagePreference]}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="system">
                  {t("settings.language.system")}
                </SelectItem>
                {SUPPORTED_LANGUAGES.map((language) => (
                  <SelectItem key={language} hideIndicator value={language}>
                    {LANGUAGE_LABELS[language]}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["responseStreamingMode"]}
          {...searchableSetting("response-streaming", t)}
          description={
            mixedResponseStreamingMode
              ? t("general.streaming.mixed")
              : t(RESPONSE_STREAMING_MODE_DESCRIPTIONS[settings.responseStreamingMode])
          }
          resetAction={
            settings.responseStreamingMode !== DEFAULT_UNIFIED_SETTINGS.responseStreamingMode ? (
              <SettingResetButton
                label={t("general.streaming.reset")}
                onClick={() =>
                  updateSettings({
                    responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={mixedResponseStreamingMode ? null : settings.responseStreamingMode}
              onValueChange={(value) => {
                if (value === "turn" || value === "paragraph") {
                  updateSettings({ responseStreamingMode: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-56"
                aria-label={t("general.streaming.label")}
              >
                <SelectValue>
                  {(value: ResponseStreamingMode | null) =>
                    value === null ? t("common.mixed") : t(RESPONSE_STREAMING_MODE_LABELS[value])
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="turn">
                  {t(RESPONSE_STREAMING_MODE_LABELS.turn)}
                </SelectItem>
                <SelectItem hideIndicator value="paragraph">
                  {t(RESPONSE_STREAMING_MODE_LABELS.paragraph)}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("hide-whitespace-changes", t)}
          description={t("general.whitespace.description")}
          resetAction={
            settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace ? (
              <SettingResetButton
                label={t("general.whitespace.reset")}
                onClick={() =>
                  updateSettings({
                    diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffIgnoreWhitespace}
              onCheckedChange={(checked) =>
                updateSettings({ diffIgnoreWhitespace: Boolean(checked) })
              }
              aria-label={t("general.whitespace.label")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("default-diff-file-state", t)}
          description={t("general.diffFiles.description")}
          resetAction={
            settings.diffFilesCollapsed !== DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed ? (
              <SettingResetButton
                label={t("general.diffFiles.reset")}
                onClick={() =>
                  updateSettings({
                    diffFilesCollapsed: DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.diffFilesCollapsed ? "collapsed" : "expanded"}
              onValueChange={(value) => {
                if (value === "expanded" || value === "collapsed") {
                  updateSettings({ diffFilesCollapsed: value === "collapsed" });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("general.diffFiles.label")}
              >
                <SelectValue>
                  {settings.diffFilesCollapsed
                    ? t("general.diffFiles.collapsed")
                    : t("general.diffFiles.expanded")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="expanded">
                  {t("general.diffFiles.expanded")}
                </SelectItem>
                <SelectItem hideIndicator value="collapsed">
                  {t("general.diffFiles.collapsed")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("diff-layout", t)}
          description={t("general.diffLayout.description")}
          resetAction={
            settings.diffLayout !== DEFAULT_UNIFIED_SETTINGS.diffLayout ? (
              <SettingResetButton
                label={t("general.diffLayout.reset")}
                onClick={() => updateSettings({ diffLayout: DEFAULT_UNIFIED_SETTINGS.diffLayout })}
              />
            ) : null
          }
          control={
            <Select
              value={settings.diffLayout}
              onValueChange={(value) => {
                if (value === "stacked" || value === "split") {
                  updateSettings({ diffLayout: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={t("general.diffLayout.label")}
              >
                <SelectValue>{t(DIFF_LAYOUT_LABELS[settings.diffLayout])}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="stacked">
                  {t(DIFF_LAYOUT_LABELS.stacked)}
                </SelectItem>
                <SelectItem hideIndicator value="split">
                  {t(DIFF_LAYOUT_LABELS.split)}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          {...searchableSetting("proactive-panels", t)}
          description={t("general.proactive.description")}
          resetAction={
            settings.proactivePanelsEnabled !== DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled ? (
              <SettingResetButton
                label={t("general.proactive.reset")}
                onClick={() =>
                  updateSettings({
                    proactivePanelsEnabled: DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.proactivePanelsEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ proactivePanelsEnabled: Boolean(checked) })
              }
              aria-label={t("general.proactive.label")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("skills-in-slash-menu", t)}
          description={t("general.skills.description")}
          resetAction={
            settings.showSkillsInSlashMenu !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu ? (
              <SettingResetButton
                label={t("general.skills.reset")}
                onClick={() =>
                  updateSettings({
                    showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.showSkillsInSlashMenu}
              onCheckedChange={(checked) =>
                updateSettings({ showSkillsInSlashMenu: Boolean(checked) })
              }
              aria-label={t("general.skills.label")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("composer-rich-text", t)}
          description={t("general.richText.description")}
          resetAction={
            settings.composerRichTextEnabled !==
            DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled ? (
              <SettingResetButton
                label={t("general.richText.reset")}
                onClick={() =>
                  updateSettings({
                    composerRichTextEnabled: DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.composerRichTextEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ composerRichTextEnabled: Boolean(checked) })
              }
              aria-label={t("general.richText.label")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("composer-collapse", t)}
          description={t("general.collapse.description")}
          resetAction={
            settings.composerCollapseOnScroll !==
            DEFAULT_UNIFIED_SETTINGS.composerCollapseOnScroll ? (
              <SettingResetButton
                label={t("general.collapse.reset")}
                onClick={() =>
                  updateSettings({
                    composerCollapseOnScroll: DEFAULT_UNIFIED_SETTINGS.composerCollapseOnScroll,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.composerCollapseOnScroll}
              onCheckedChange={(checked) =>
                updateSettings({ composerCollapseOnScroll: Boolean(checked) })
              }
              aria-label={t("general.collapse.label")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("send-shortcut", t)}
          description={t("general.send.description")}
          resetAction={
            settings.sendShortcut !== DEFAULT_UNIFIED_SETTINGS.sendShortcut ? (
              <SettingResetButton
                label={t("general.send.reset")}
                onClick={() =>
                  updateSettings({ sendShortcut: DEFAULT_UNIFIED_SETTINGS.sendShortcut })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sendShortcut}
              onValueChange={(value) => {
                const option = sendShortcutOptions.find((option) => option.value === value);
                if (option) updateSettings({ sendShortcut: option.value });
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-auto min-w-0 max-w-full"
                aria-label={t("general.send.label")}
              >
                <SelectValue>
                  {
                    sendShortcutOptions.find((option) => option.value === settings.sendShortcut)
                      ?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {sendShortcutOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="flex items-center justify-between gap-4">
                      {option.label}
                      {settings.sendShortcut === option.value && <CheckIcon aria-hidden="true" />}
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          {...searchableSetting("follow-up-behavior", t)}
          description={
            t("general.followUp.description") +
            " " +
            (settings.sendShortcut === "mod-enter-multiline"
              ? t("general.followUp.oppositeMultiline", { modifier: modifierLabel })
              : t("general.followUp.opposite", {
                  shortcut: `${modifierLabel}${settings.sendShortcut === "mod-enter" ? " + Shift" : ""} + Enter`,
                }))
          }
          resetAction={
            settings.followUpBehavior !== DEFAULT_UNIFIED_SETTINGS.followUpBehavior ? (
              <SettingResetButton
                label={t("general.followUp.reset")}
                onClick={() =>
                  updateSettings({
                    followUpBehavior: DEFAULT_UNIFIED_SETTINGS.followUpBehavior,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.followUpBehavior}
              onValueChange={(value) => {
                if (value === "queue" || value === "steer") {
                  updateSettings({ followUpBehavior: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-auto min-w-0"
                aria-label={t("general.followUp.label")}
              >
                <SelectValue>
                  {settings.followUpBehavior === "queue"
                    ? t("general.followUp.queue")
                    : t("general.followUp.steer")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="queue">{t("general.followUp.queue")}</SelectItem>
                <SelectItem value="steer">{t("general.followUp.steer")}</SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          serverScoped
          settingKeys={["enableProviderUpdateChecks"]}
          {...searchableSetting("provider-update-checks", t)}
          description={t("general.providerUpdates.description")}
          resetAction={
            settings.enableProviderUpdateChecks !==
            DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks ? (
              <SettingResetButton
                label={t("general.providerUpdates.reset")}
                onClick={() =>
                  updateSettings({
                    enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["enableProviderUpdateChecks"]}
              checked={settings.enableProviderUpdateChecks}
              onCheckedChange={(checked) =>
                updateSettings({ enableProviderUpdateChecks: Boolean(checked) })
              }
              aria-label={t("general.providerUpdates.label")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("continue-threads-after-server-update", t)}
          serverScoped
          settingKeys={["continueThreadsAfterServerUpdate"]}
          description={t("general.restart.description")}
          status={!supportsRestartContinuation ? t("general.restart.unsupported") : undefined}
          resetAction={
            supportsRestartContinuation &&
            settings.continueThreadsAfterServerUpdate !==
              DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate ? (
              <SettingResetButton
                label={t("general.restart.reset")}
                onClick={() =>
                  updateSettings({
                    continueThreadsAfterServerUpdate:
                      DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["continueThreadsAfterServerUpdate"]}
              checked={settings.continueThreadsAfterServerUpdate}
              disabled={!supportsRestartContinuation}
              onCheckedChange={(checked) =>
                updateSettings({ continueThreadsAfterServerUpdate: Boolean(checked) })
              }
              aria-label={t("general.restart.label")}
            />
          }
        />

        <BackgroundActivitySettingsRow />
      </SettingsSection>

      <SettingsSection id="projects-and-threads" title={t("section.projectsThreads")}>
        <SettingsRow
          serverScoped
          settingKeys={["newWorktreesStartFromOrigin"]}
          {...searchableSetting("start-from-origin", t)}
          description={t("general.origin.description")}
          resetAction={
            settings.newWorktreesStartFromOrigin !==
            DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin ? (
              <SettingResetButton
                label={t("general.origin.reset")}
                onClick={() =>
                  updateSettings({
                    newWorktreesStartFromOrigin:
                      DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["newWorktreesStartFromOrigin"]}
              checked={settings.newWorktreesStartFromOrigin}
              onCheckedChange={(checked) =>
                updateSettings({ newWorktreesStartFromOrigin: Boolean(checked) })
              }
              aria-label={t("general.origin.label")}
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["addProjectBaseDirectory"]}
          {...searchableSetting("add-project-starts-in", t)}
          description={t("general.baseDirectory.description")}
          resetAction={
            settings.addProjectBaseDirectory !==
            DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory ? (
              <SettingResetButton
                label={t("general.baseDirectory.reset")}
                onClick={() =>
                  updateSettings({
                    addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
                  })
                }
              />
            ) : null
          }
          control={
            <DraftInput
              size="sm"
              className="w-full sm:w-72"
              value={mixedAddProjectBaseDirectory ? "" : settings.addProjectBaseDirectory}
              onCommit={(next) => updateSettings({ addProjectBaseDirectory: next })}
              placeholder={mixedAddProjectBaseDirectory ? t("common.mixed") : "~/"}
              spellCheck={false}
              aria-label={t("general.baseDirectory.label")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="confirmations" title={t("section.confirmations")}>
        <SettingsRow
          {...searchableSetting("unpin-confirmation", t)}
          description={t("general.unpin.description")}
          resetAction={
            settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin ? (
              <SettingResetButton
                label={t("general.unpin.reset")}
                onClick={() =>
                  updateSettings({
                    confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadUnpin}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadUnpin: Boolean(checked) })
              }
              aria-label={t("general.unpin.label")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("archive-confirmation", t)}
          description={t("general.archive.description")}
          resetAction={
            settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
              <SettingResetButton
                label={t("general.archive.reset")}
                onClick={() =>
                  updateSettings({
                    confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadArchive}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadArchive: Boolean(checked) })
              }
              aria-label={t("general.archive.label")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("delete-confirmation", t)}
          description={t("general.delete.description")}
          resetAction={
            settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
              <SettingResetButton
                label={t("general.delete.reset")}
                onClick={() =>
                  updateSettings({
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadDelete}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadDelete: Boolean(checked) })
              }
              aria-label={t("general.delete.label")}
            />
          }
        />

        {isElectron ? (
          <SettingsRow
            {...searchableSetting("quit-confirmation", t)}
            description={t("general.quit.note")}
            resetAction={
              settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit ? (
                <SettingResetButton
                  label={t("general.quit.reset")}
                  onClick={() =>
                    updateSettings({ confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.confirmQuit}
                onValueChange={(value) => {
                  if (value === "direct" || value === "hold" || value === "double-click") {
                    updateSettings({ confirmQuit: value });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={t("general.quit.label")}
                >
                  <SelectValue>
                    {t(QUIT_CONFIRMATION_MODE_LABELS[settings.confirmQuit])}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {Object.entries(QUIT_CONFIRMATION_MODE_LABELS).map(([value, labelKey]) => (
                    <SelectItem hideIndicator key={value} value={value}>
                      {t(labelKey)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        ) : null}
      </SettingsSection>

      <SettingsSection id="text-generation" title={t("section.textGeneration")}>
        <SettingsRow
          serverScoped
          settingKeys={["textGenerationModelSelection"]}
          {...searchableSetting("text-generation-model", t)}
          description={t("general.textModel.description")}
          resetAction={
            hasServerTargets && isTextGenerationModelDirty ? (
              <SettingResetButton
                label={t("general.textModel.reset")}
                onClick={() =>
                  updateSettings({
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            !hasServerTargets ? (
              <span className="text-sm text-muted-foreground">
                {t("general.textModel.connect")}
              </span>
            ) : !hasTextGenerationProvider ? (
              <span className="text-sm text-muted-foreground">{t("general.textModel.empty")}</span>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <ProviderModelPicker
                  environmentId={environmentId}
                  activeInstanceId={textGenInstanceId}
                  model={textGenModel}
                  lockedProvider={null}
                  instanceEntries={textGenerationModelInstanceEntries}
                  modelOptionsByInstance={textGenerationModelOptionsByInstance}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  {...(mixedTextGenerationModel ? { triggerLabel: t("common.mixed") } : {})}
                  getModelDisabledReason={textGenerationModelDisabledReason}
                  {...(environmentId
                    ? {
                        onOpenProviderSetup: (instanceId: ProviderInstanceId) => {
                          void navigate({
                            to: "/settings/providers",
                            search: { environmentId, instanceId },
                          });
                        },
                      }
                    : {})}
                  onInstanceModelChange={(instanceId, model) => {
                    const reason = textGenerationModelDisabledReason(instanceId, model);
                    if (reason) {
                      toastManager.add({
                        type: "error",
                        title: t("general.textModel.notSaved"),
                        description: reason,
                      });
                      return;
                    }
                    updateSettings({
                      textGenerationModelSelection: resolveAppModelSelectionState(
                        {
                          ...settings,
                          textGenerationModelSelection: createModelSelection(instanceId, model),
                        },
                        textGenerationProviders,
                      ),
                    });
                  }}
                />
                {textGenInstanceEntry ? (
                  <TraitsPicker
                    provider={textGenProvider}
                    models={textGenInstanceEntry?.models ?? []}
                    model={textGenModel}
                    modelOptions={textGenModelOptions}
                    allowPromptInjectedEffort={false}
                    planModeEnabled={
                      settings.planModeEnabled || selectsPlanAgent(textGenModelOptions)
                    }
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    onModelOptionsChange={(nextOptions) => {
                      updateSettings({
                        textGenerationModelSelection: resolveAppModelSelectionState(
                          {
                            ...settings,
                            textGenerationModelSelection: createModelSelection(
                              textGenInstanceId,
                              textGenModel,
                              nextOptions,
                            ),
                          },
                          textGenerationProviders,
                        ),
                      });
                    }}
                  />
                ) : null}
              </div>
            )
          }
        />
      </SettingsSection>

      <SettingsSection id="about" title={t("section.about")}>
        {isElectron || HOSTED_APP_CHANNEL ? (
          <AboutVersionSection />
        ) : (
          <>
            <SettingsRow
              id={searchableSetting("app-version").id}
              title={<AboutVersionTitle />}
              description={t("about.version.description")}
            />
          </>
        )}
        <MobileAppSettingsRow />
        <SettingsRow
          {...searchableSetting("privacy-policy", t)}
          description={t("about.privacy.description")}
          control={
            <Button
              render={
                <a href="https://t3.codes/privacy" target="_blank" rel="noreferrer noopener" />
              }
              size="sm"
              variant="outline"
            >
              {t("about.privacy.view")}
            </Button>
          }
        />
      </SettingsSection>
      <SettingsSection title={t("about.diagnostics")}>
        <SettingsRow
          {...searchableSetting("diagnostics", t)}
          description={
            isEnvironmentScope
              ? t("about.diagnostics.description")
              : t("about.diagnostics.oneEnvironment")
          }
          control={
            <Button
              render={
                <Link to="/settings/diagnostics" search={{ machine: environmentId ?? undefined }} />
              }
              size="sm"
              variant="outline"
            >
              {t("about.diagnostics.view")}
            </Button>
          }
        />
        <SettingsRow
          {...searchableSetting("open-source-licenses", t)}
          description={t("about.licenses.description")}
          control={
            <Button
              render={<Link to="/settings/open-source-licenses" />}
              size="sm"
              variant="outline"
            >
              {t("about.licenses.view")}
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
