import { useRef } from "react";
import { useTranslate } from "../../i18n";

import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function ThreadTitleInstructionsSettings() {
  const t = useTranslate();
  const settings = useScopedSettings();
  const { targets } = useSettingsScope();
  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const edited = useRef(false);
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["threadTitleInstructions"]);

  return (
    <SettingsRow
      serverScoped
      settingKeys={["threadTitleInstructions"]}
      {...searchableSetting("thread-title-instructions")}
      description={t("threadTitle.instructions.description")}
      resetAction={
        mixed || settings.threadTitleInstructions !== "" ? (
          <SettingResetButton
            label={t("threadTitle.instructions.reset")}
            onClick={() => updateSettings({ threadTitleInstructions: "" })}
          />
        ) : null
      }
    >
      <div className="mt-3 max-w-2xl pb-3.5">
        <Textarea
          key={`${scopeKey}:${mixed}:${settings.threadTitleInstructions}`}
          aria-label={t("settings.search.thread-title-instructions.title")}
          onChange={() => {
            edited.current = true;
          }}
          rows={4}
          defaultValue={mixed ? "" : settings.threadTitleInstructions}
          placeholder={
            mixed ? t("threadTitle.instructions.mixed") : t("threadTitle.instructions.placeholder")
          }
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (edited.current && (mixed || value !== settings.threadTitleInstructions))
              updateSettings({ threadTitleInstructions: value });
            edited.current = false;
          }}
        />
      </div>
    </SettingsRow>
  );
}
