import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  type LanguagePreference,
} from "@t3tools/client-runtime/i18n";

import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { useGT } from "gt-react-native";
import { useLanguagePreference } from "../../i18n/I18nProvider";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";

const LANGUAGE_OPTIONS: readonly LanguagePreference[] = ["system", ...SUPPORTED_LANGUAGES];

export function LanguageSettingsSection() {
  const gt = useGT();
  const language = useLanguagePreference();
  return (
    <SettingsSection>
      <SettingsRow
        icon="globe"
        label={gt("Language")}
        value={language === "system" ? gt("System default") : LANGUAGE_LABELS[language]}
        target="SettingsLanguage"
      />
    </SettingsSection>
  );
}

export function SettingsLanguageRouteScreen() {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const preferencesReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const selected = AsyncResult.isSuccess(preferencesResult)
    ? (preferencesResult.value.languagePreference ?? "system")
    : null;

  return (
    <SettingsScreen title={gt("Language")}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-3 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection title={gt("Language")}>
          {LANGUAGE_OPTIONS.map((preference, index) => (
            <ListChoiceRow
              key={preference}
              label={preference === "system" ? gt("System default") : LANGUAGE_LABELS[preference]}
              description={preference === "system" ? gt("Follow the device language.") : undefined}
              selected={selected === preference}
              separated={index > 0}
              disabled={!preferencesReady}
              onPress={() => void savePreferences({ languagePreference: preference })}
            />
          ))}
        </SettingsSection>
      </ScrollView>
    </SettingsScreen>
  );
}
