import { useTranslate } from "../../i18n";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { settingsSectionLabel } from "./settingsSearch";
import { SETTINGS_SECTIONS } from "./settingsSections";

export function SettingsBreadcrumb({ pathname }: { pathname: string }) {
  const t = useTranslate();
  const labels: Readonly<Record<string, string>> = {
    ...Object.fromEntries(
      SETTINGS_SECTIONS.map((section) => [section.path, settingsSectionLabel(section.path, t)]),
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
