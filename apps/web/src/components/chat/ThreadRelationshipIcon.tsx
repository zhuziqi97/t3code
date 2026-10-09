import { i18n } from "../../i18n";
import type { TFunction } from "i18next";
import type { ProviderDriverKind, ServerProvider } from "@t3tools/contracts";
import { BotIcon, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

export function threadRelationshipStatusLabel(
  status: string | null,
  t: TFunction = i18n.t,
): string {
  switch (status) {
    case "preparing":
    case "starting":
      return t("chat.status.starting");
    case "running":
    case "in_progress":
      return t("chat.status.running");
    case "pending":
    case "queued":
      return t("chat.timeline.queuedShort");
    case "waiting":
    case "blocked":
      return t("thread.waiting");
    case "completed":
      return t("thread.done");
    case "failed":
    case "error":
      return t("thread.failed");
    case "cancelled":
    case "interrupted":
      return t("chat.status.stopped");
    case "rolled_back":
      return t("chat.status.reverted");
    case "resolved_native":
      return t("chat.relationship.resolvedNative");
    case "resolved_portable":
      return t("chat.relationship.resolvedPortable");
    case "consumed":
      return t("chat.status.consumed");
    case "superseded":
      return t("chat.status.superseded");
    case "idle":
      return t("chat.status.idle");
    default:
      return t("common.unknown");
  }
}

/** Shared by lineage and timeline links, including the provider glyph and status badge. */
export function ThreadRelationshipIcon({
  driver,
  provider,
  status,
  fallbackIcon: FallbackIcon = BotIcon,
}: {
  driver?: ProviderDriverKind | undefined;
  provider?: ServerProvider | undefined;
  status: string | null;
  fallbackIcon?: LucideIcon;
}) {
  const iconClassName = "size-4 shrink-0 text-muted-foreground";
  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      {driver ? (
        <ProviderInstanceIcon
          driverKind={driver}
          displayName={provider?.displayName ?? driver}
          acpRegistryIconUrl={provider?.iconUrl}
          iconClassName={iconClassName}
          className="z-auto"
        />
      ) : (
        <FallbackIcon className={iconClassName} />
      )}
      <span
        className={cn(
          "absolute -bottom-1 -right-1 size-2 rounded-full border-2 border-card",
          status === "running" ||
            status === "in_progress" ||
            status === "pending" ||
            status === "waiting"
            ? "bg-info"
            : status === "failed" || status === "error"
              ? "bg-destructive"
              : status === "completed"
                ? "bg-success"
                : "bg-muted-foreground/45",
        )}
        aria-hidden="true"
      />
    </span>
  );
}
