import type { TFunction } from "i18next";
import { i18n, useTranslate } from "../../i18n";
import { useAtomValue } from "@effect/atom-react";
import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import {
  pullRequestRoutingConnectionKey,
  pullRequestRoutingPermissionFor,
  type PullRequestRoutingPermission,
} from "@t3tools/client-runtime/connection";
import { useState } from "react";

import { environmentCatalog } from "~/connection/catalog";
import type { EnvironmentPresentation } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { EnvironmentRow, environmentTransportLabel } from "./EnvironmentRow";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { searchableSetting } from "./settingsSearch";

const options: ReadonlyArray<{ value: PullRequestRoutingPermission; label: string }> = [
  { value: "off", label: "Off" },
  { value: "read", label: "Read PRs" },
  { value: "read-write", label: "Read and act" },
];

/**
 * Closed-header summary: the machines that share, grouped by permission.
 * Null when nothing is shared.
 */
function summarizePullRequestRouting(
  entries: ReadonlyArray<{
    readonly label: string;
    readonly permission: PullRequestRoutingPermission;
  }>,
  t: TFunction = i18n.t,
): string | null {
  const groups = (["read-write", "read"] as const).flatMap((permission) => {
    const labels = entries.filter((entry) => entry.permission === permission);
    return labels.length === 0
      ? []
      : [
          `${labels.map((entry) => entry.label).join(", ")} ${t(permission === "read" ? "connections.githubSummaryRead" : "connections.githubSummaryAct")}`,
        ];
  });
  return groups.length === 0 ? null : groups.join(" · ");
}

export function PullRequestRoutingSettings({
  environments,
}: {
  readonly environments: ReadonlyArray<EnvironmentPresentation>;
}) {
  const t = useTranslate();
  const permissions = useAtomValue(environmentCatalog.pullRequestRoutingPermissionsValueAtom);
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const update = useAtomCommand(environmentCatalog.setPullRequestRoutingPermission);
  const [saving, setSaving] = useState(false);

  if (environments.length < 2) return null;

  const { id, title } = searchableSetting("pull-request-routing", t);
  const translatedOptions = options.map((entry) => ({
    ...entry,
    label: t(
      entry.value === "off"
        ? "connections.off"
        : entry.value === "read"
          ? "connections.githubRead"
          : "connections.githubAct",
    ),
  }));
  return (
    <FoldedSettingsSection
      id={id}
      title={title}
      summary={
        summarizePullRequestRouting(
          environments.map((environment) => ({
            label: environment.label,
            permission: pullRequestRoutingPermissionFor(environment.entry, permissions),
          })),
          t,
        ) ?? t("connections.off")
      }
    >
      <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
        {t("connections.githubRoutingHint")}
      </p>
      {environments.map((environment) => (
        <EnvironmentRow
          key={environment.environmentId}
          kind={resolveEnvironmentMachineKind(environment.serverConfig)}
          label={environment.label}
          subtitle={environmentTransportLabel(environment, null, t)}
        >
          <Select
            items={translatedOptions}
            value={pullRequestRoutingPermissionFor(environment.entry, permissions)}
            disabled={
              !catalog.isReady ||
              saving ||
              pullRequestRoutingConnectionKey(environment.entry) === null
            }
            onValueChange={(permission) => {
              if (permission === null) return;
              setSaving(true);
              void update({ environmentId: environment.environmentId, permission }).then(
                (result) => {
                  setSaving(false);
                  if (result._tag === "Failure")
                    toastManager.add({
                      type: "error",
                      title: "Could not save pull request routing permission",
                    });
                },
              );
            }}
          >
            <SelectTrigger
              size="xs"
              className="w-32"
              aria-label={t("connections.githubRoutingLabel", { label: environment.label })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {translatedOptions.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </EnvironmentRow>
      ))}
    </FoldedSettingsSection>
  );
}
