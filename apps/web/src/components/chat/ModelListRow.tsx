import { useTranslate } from "../../i18n";
import { type ProviderDriverKind, type ProviderInstanceId } from "@t3tools/contracts";
import { memo, useRef } from "react";
import { CheckIcon, StarIcon } from "lucide-react";
import { getDisplayModelName } from "./providerIconUtils";
import { ComboboxItem } from "../ui/combobox";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { modelPickerModelKey } from "./modelPickerKeys";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

export const ModelListRow = memo(function ModelListRow(props: {
  index: number;
  slug: string;
  name: string;
  subProvider?: string | undefined;
  instanceId: ProviderInstanceId;
  driverKind: ProviderDriverKind;
  providerDisplayName: string;
  providerAccentColor?: string | undefined;
  acpRegistryAgentId?: string | undefined;
  acpRegistryIconUrl?: string | undefined;
  isFavorite: boolean;
  /** In Favorites every row is starred, so the star shows only on hover. */
  favoriteStarOnHover?: boolean;
  isSelected: boolean;
  /** Marks this instance apart from another of the same provider. */
  showInstanceBadge: boolean;
  showModelId?: boolean;
  showNewBadge?: boolean;
  unavailable?: boolean;
  jumpLabel?: string | null;
  disabledReason?: string | null;
  inlineDetails: boolean;
  detailsOpen: boolean;
  onDetailsOpenChange: (open: boolean) => void;
  onToggleFavorite: (instanceId: ProviderInstanceId, slug: string) => void;
}) {
  const t = useTranslate();
  const model = {
    slug: props.slug,
    name: props.name,
    subProvider: props.subProvider,
  };
  const modelName = getDisplayModelName(model);
  const showModelId = props.showModelId || props.slug !== modelName;
  const rowRef = useRef<HTMLDivElement>(null);

  const row = (
    <ComboboxItem
      ref={rowRef}
      render={props.inlineDetails ? <div /> : <TooltipTrigger render={<div />} />}
      hideIndicator
      selectedFill={false}
      index={props.index}
      value={modelPickerModelKey(props.instanceId, props.slug)}
      disabled={Boolean(props.disabledReason)}
      className={cn(
        "group relative w-full !min-w-0 max-w-full cursor-pointer",
        props.disabledReason &&
          "data-disabled:pointer-events-auto data-disabled:cursor-not-allowed",
      )}
    >
      <ProviderInstanceIcon
        driverKind={props.driverKind}
        displayName={props.providerDisplayName}
        accentColor={props.providerAccentColor}
        acpRegistryAgentId={props.acpRegistryAgentId}
        acpRegistryIconUrl={props.acpRegistryIconUrl}
        showBadge={props.showInstanceBadge}
        className="size-4"
        iconClassName="size-4"
        indicatorBackground="var(--popover)"
        badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 px-0.5 text-5xs"
      />
      <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <div className="min-w-0 flex-1 py-1">
          <div className="line-clamp-2 wrap-anywhere whitespace-normal text-sm font-normal leading-snug">
            {modelName}
          </div>
          <div className="truncate text-xs leading-snug text-muted-foreground">
            {props.providerDisplayName}
            {props.subProvider ? ` · ${props.subProvider}` : null}
          </div>
          {showModelId ? (
            <div className="truncate font-mono text-xs leading-snug text-muted-foreground">
              {props.slug}
            </div>
          ) : null}
        </div>
        {props.isSelected ? <CheckIcon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
        {props.showNewBadge ? (
          <span
            className="shrink-0 rounded border border-update/35 bg-update/15 px-0.5 py-px text-3xs font-bold uppercase leading-none tracking-wide text-update-foreground"
            aria-label={t("chat.model.new")}
          >
            {t("chat.model.newShort")}
          </span>
        ) : null}
        {props.unavailable ? (
          <Badge variant="outline" size="sm">
            {t("common.unavailable")}
          </Badge>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onToggleFavorite(props.instanceId, props.slug);
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                }}
                disabled={Boolean(props.disabledReason)}
                aria-label={t(props.isFavorite ? "chat.model.unfavorite" : "chat.model.favorite")}
              >
                <StarIcon
                  className={cn(
                    "size-3.5 sm:size-3",
                    props.isFavorite && "fill-current text-warning",
                    (!props.isFavorite || props.favoriteStarOnHover) &&
                      "opacity-0 group-hover:opacity-100 group-data-highlighted:opacity-100 in-focus-visible:opacity-100 pointer-coarse:opacity-100",
                  )}
                />
              </Button>
            }
          />
          <TooltipPopup side="top" align="center">
            {t(props.isFavorite ? "chat.model.unfavorite" : "chat.model.favorite")}
          </TooltipPopup>
        </Tooltip>
        {props.jumpLabel ? <Kbd>{props.jumpLabel}</Kbd> : null}
      </div>
    </ComboboxItem>
  );

  if (props.inlineDetails) {
    return (
      <>
        {row}
        <details className="px-8 pb-1 text-xs" onKeyDown={(event) => event.stopPropagation()}>
          <summary className="w-fit cursor-pointer text-muted-foreground">
            {t("common.details")}
          </summary>
          <div className="mt-1 max-h-40 space-y-1 overflow-y-auto overscroll-contain wrap-anywhere whitespace-normal select-text">
            <div>{modelName}</div>
            <div className="text-muted-foreground">
              {props.providerDisplayName}
              {props.subProvider ? ` · ${props.subProvider}` : null}
            </div>
            {showModelId ? <div className="font-mono">{props.slug}</div> : null}
            {props.disabledReason ? <div>{props.disabledReason}</div> : null}
          </div>
        </details>
      </>
    );
  }

  return (
    <Tooltip
      open={props.detailsOpen}
      onOpenChange={(open) => {
        const truncated = Array.from(
          rowRef.current?.querySelectorAll(".line-clamp-2, .truncate") ?? [],
        ).some(
          (element) =>
            element.scrollWidth > element.clientWidth ||
            element.scrollHeight > element.clientHeight,
        );
        props.onDetailsOpenChange(open && (Boolean(props.disabledReason) || truncated));
      }}
    >
      {row}
      <TooltipPopup
        side="right"
        align="start"
        anchor={() =>
          rowRef.current?.closest<HTMLElement>("[data-model-picker-content]") ?? rowRef.current
        }
      >
        <div className="pointer-events-auto max-h-[min(24rem,50dvh,calc(var(--available-height)-1rem))] space-y-1 overflow-y-auto">
          <div>{modelName}</div>
          <div className="text-muted-foreground">
            {props.providerDisplayName}
            {props.subProvider ? ` · ${props.subProvider}` : null}
          </div>
          {showModelId ? <div className="font-mono">{props.slug}</div> : null}
          {props.disabledReason ? <div>{props.disabledReason}</div> : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
});
