import type { ReactNode } from "react";
import type { DeviceToolVersions as ToolVersions } from "@t3tools/contracts";
import { InlineButton } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { useTranslate } from "../../i18n";

export function DeviceToolVersions({
  tools,
  action,
  kind,
  owner,
  error,
}: {
  tools: ToolVersions | undefined;
  action?: ReactNode;
  kind?: keyof ToolVersions;
  owner?: string | undefined;
  error?: string | undefined;
}) {
  const t = useTranslate();
  const selected = kind ? tools?.[kind] : undefined;
  const version =
    selected?.runningVersion ??
    (selected?.installedVersions.includes(selected.requiredVersion)
      ? selected.requiredVersion
      : selected?.installedVersions
          .toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .at(-1));
  const label = t(kind === "hub" ? "device.hub.title" : "device.agent.title");
  return (
    <Popover>
      <PopoverTrigger
        aria-label={
          kind
            ? t(
                version
                  ? "device.tools.details-version"
                  : selected
                    ? "device.tools.details-uninstalled"
                    : "device.tools.details-unknown",
                { tool: label, version },
              )
            : undefined
        }
        render={<InlineButton tone="muted" />}
      >
        {kind
          ? version
            ? `v${version}`
            : selected
              ? t("device.tools.not-installed")
              : t("device.tools.unknown")
          : error
            ? t("device.tools.unavailable")
            : t("device.tools.versions")}
      </PopoverTrigger>
      <PopoverPopup align="end" width="md">
        <PopoverTitle>{kind ? label : t("device.tools.title")}</PopoverTitle>
        {tools ? (
          <div className="mt-4 divide-y divide-border/50">
            {(
              [
                ["hub", tools.hub],
                ["agent", tools.agent],
              ] as const
            )
              .filter(([toolKind]) => !kind || toolKind === kind)
              .map(([toolKind, tool]) => (
                <div key={toolKind} className="space-y-2 py-3 first:pt-0 last:pb-0">
                  {!kind ? (
                    <p className="text-xs font-medium">
                      {t(toolKind === "hub" ? "device.hub.title" : "device.agent.title")}
                    </p>
                  ) : null}
                  <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">{t("device.tools.running")}</dt>
                    <dd className="text-right font-mono">
                      {tool.runningVersion ?? t("device.tools.not-running")}
                    </dd>
                    <dt className="text-muted-foreground">{t("device.tools.required")}</dt>
                    <dd className="text-right font-mono">{tool.requiredVersion}</dd>
                    <dt className="text-muted-foreground">{t("device.tools.installed")}</dt>
                    <dd className="text-right font-mono break-words">
                      {tool.installedVersions.join(", ") || t("device.tools.none")}
                    </dd>
                  </dl>
                </div>
              ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">{t("device.tools.not-checked")}</p>
        )}
        <p className="mt-4 border-t border-border/50 pt-3 text-xs text-muted-foreground">
          {owner ? t("device.tools.owner-update", { owner }) : t("device.tools.auto-update")}
        </p>
        {error ? (
          <p role="status" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </PopoverPopup>
    </Popover>
  );
}
