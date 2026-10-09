import { useTranslate } from "../../i18n";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { SETTINGS_SECTION_LABELS, settingsSectionLabel, type SettingsPath } from "./settingsSearch";

/**
 * `Settings / Section`. The scope a change applies to lives at the top of the
 * page content, see `SettingsScopeSentence`.
 */
export function SettingsBreadcrumb({ pathname }: { pathname: string }) {
  const t = useTranslate();
  const labels: Readonly<Record<string, string>> = {
    ...Object.fromEntries(
      (Object.keys(SETTINGS_SECTION_LABELS) as SettingsPath[]).map((to) => [
        to,
        settingsSectionLabel(to, t),
      ]),
    ),
    "/settings/diagnostics": t("about.diagnostics"),
    "/settings/open-source-licenses": t("breadcrumb.licenses"),
  };
  const sectionLabel = labels[pathname.replace(/\/+$/, "") || "/"] ?? null;

  return (
    <WorkspaceBreadcrumb ariaLabel={t("breadcrumb.label")}>
      {sectionLabel ? (
        <>
          <WorkspaceBreadcrumbItem>{t("breadcrumb.settings")}</WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
        </>
      ) : null}
      <WorkspaceBreadcrumbItem current className="truncate">
        {sectionLabel ?? t("breadcrumb.settings")}
      </WorkspaceBreadcrumbItem>
    </WorkspaceBreadcrumb>
  );
}
