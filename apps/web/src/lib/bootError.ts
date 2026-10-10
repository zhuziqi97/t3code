import {
  isLanguagePreference,
  resolveLanguage,
  type LanguagePreference,
} from "@t3tools/client-runtime/i18n/languages";
import { CLIENT_SETTINGS_STORAGE_KEY } from "../clientSettingsStorageKey";

// Startup errors must render even when the React/i18next application chunk cannot load.
const messages = {
  en: { failed: "T3 Code could not load.", reload: "Reload" },
  zh: { failed: "T3 Code 无法加载。", reload: "重新加载" },
};

function bootMessages() {
  let preference: LanguagePreference = "system";
  try {
    const raw =
      typeof window === "undefined"
        ? null
        : window.localStorage?.getItem(CLIENT_SETTINGS_STORAGE_KEY);
    const settings: unknown = raw ? JSON.parse(raw) : null;
    if (typeof settings === "object" && settings !== null && "languagePreference" in settings) {
      const value = settings.languagePreference;
      if (typeof value === "string" && isLanguagePreference(value)) preference = value;
    }
  } catch {
    // Storage failure can itself prevent app startup. The error surface still needs to work.
  }
  const locales = typeof navigator === "undefined" ? [] : navigator.languages;
  return messages[resolveLanguage(preference, locales)];
}

/** Shows startup failures before React can replace the boot splash. */
export function showBootError(error: unknown) {
  console.error("T3 Code failed to start.", error);
  const bootShell = document.getElementById("boot-shell");
  if (!bootShell) return;

  const labels = bootMessages();
  const content = document.createElement("div");
  content.id = "boot-error";
  content.setAttribute("role", "alert");

  const message = document.createElement("p");
  message.textContent = labels.failed;
  content.append(message);

  if (import.meta.env.DEV && error instanceof Error) {
    const detail = document.createElement("p");
    detail.textContent = error.message;
    content.append(detail);
  }

  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = labels.reload;
  reload.addEventListener("click", () => window.location.reload());
  content.append(reload);
  bootShell.replaceChildren(content);

  if (typeof window !== "undefined" && window.desktopBridge) {
    return window.desktopBridge.getClientSettings().then(
      (settings) => {
        const locales = typeof navigator === "undefined" ? [] : navigator.languages;
        const labels = messages[resolveLanguage(settings?.languagePreference ?? "system", locales)];
        message.textContent = labels.failed;
        reload.textContent = labels.reload;
      },
      () => {
        // Keep the working fallback when desktop settings cannot be read during startup.
      },
    );
  }
}
