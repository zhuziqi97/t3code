import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  type LanguagePreference,
} from "@t3tools/client-runtime/i18n";

import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { I18nProvider, useGT, useLanguagePreference } from "../../i18n/I18nProvider";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";

/** `system` follows the device locale; i18next falls back to English per key. */
const LANGUAGE_OPTIONS: ReadonlyArray<{
  readonly preference: LanguagePreference;
  readonly label: string;
  readonly description: string;
}> = [
  {
    preference: "system",
    label: "System default",
    description: "Follow the device language.",
  },
  ...SUPPORTED_LANGUAGES.map((language) => ({
    preference: language satisfies LanguagePreference,
    label: LANGUAGE_LABELS[language],
    description: "",
  })),
];

export function LanguageSettingsSection() {
  return (
    <I18nProvider>
      <LanguageRow />
    </I18nProvider>
  );
}

function LanguageRow() {
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
  return (
    <I18nProvider>
      <LanguageSettings />
    </I18nProvider>
  );
}

function LanguageSettings() {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
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
          {LANGUAGE_OPTIONS.map((option, index) => (
            <ListChoiceRow
              key={option.preference}
              label={option.preference === "system" ? gt("System default") : option.label}
              description={
                option.preference === "system"
                  ? gt("Follow the device language.")
                  : option.description
              }
              selected={selected === option.preference}
              separated={index > 0}
              disabled={!preferencesReady}
              onPress={() => savePreferences({ languagePreference: option.preference })}
            />
          ))}
        </SettingsSection>
      </ScrollView>
    </SettingsScreen>
  );
}
