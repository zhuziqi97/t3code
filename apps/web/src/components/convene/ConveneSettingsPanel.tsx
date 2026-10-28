import { useTranslate } from "../../i18n";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { ConveneConnectionPanel } from "./ConveneConnectionPanel";
import { SettingsPageContainer, SettingsSection } from "../settings/settingsLayout";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";

export function ConveneSettingsPanel() {
  const t = useTranslate();
  const { environments } = useEnvironments();
  const primaryId = usePrimaryEnvironmentId();
  const search = useSearch({ from: "/_chat/settings" });
  const navigate = useNavigate();
  const environmentId = search.machine
    ? (environments.find((environment) => environment.environmentId === search.machine)
        ?.environmentId ?? null)
    : (primaryId ?? environments[0]?.environmentId ?? null);
  return (
    <SettingsPageContainer>
      <SettingsSection id="convene-connection" title="Convene" variant="plain">
        <div className="space-y-5 p-4">
          {(environments.length > 1 || (search.machine && environmentId === null)) && (
            <div className="max-w-sm">
              <Select
                value={environmentId}
                onValueChange={(value) => {
                  if (value) void navigate({ to: "/settings/convene", search: { machine: value } });
                }}
                items={environments.map((environment) => ({
                  value: environment.environmentId,
                  label: environment.label,
                }))}
              >
                <SelectTrigger aria-label={t("convene.settings.environment")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {environments.map((environment) => (
                    <SelectItem key={environment.environmentId} value={environment.environmentId}>
                      {environment.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          )}
          {environmentId ? (
            <ConveneConnectionPanel key={environmentId} environmentId={environmentId} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("convene.settings.connectFirst")}</p>
          )}
        </div>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
