import { isReasoningOption } from "@t3tools/shared/model";
import {
  getSelectedTraits,
  getTraitsSectionVisibility,
  shouldRenderTraitsControls,
} from "./TraitsPicker.logic";
import {
  buildTraitsTriggerDisplay,
  getDescriptorStringValue,
  getTraitSelectChange,
  replaceDescriptorCurrentValue,
  selectableProviderOptionChoices,
  ULTRATHINK_PROMPT_PREFIX,
} from "@t3tools/client-runtime/model-traits";
import {
  formatProviderOptionName,
  formatProviderOptionChoiceLabel,
  formatProviderOptionDescription,
  getLocalizedProviderOptionCurrentLabel,
} from "@t3tools/client-runtime/provider-option-labels";
import { useTranslate } from "../../i18n";
import {
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  isClaudeUltrathinkPrompt,
} from "@t3tools/shared/model";
import { memo } from "react";
import { BrainIcon, GaugeIcon } from "lucide-react";
import {
  Menu,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";
import { useComposerDraftStore, DraftId } from "../../composerDraftStore";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  ComposerControl,
  ComposerControlChevron,
  ComposerControlIcon,
  type ComposerControlSize,
} from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";

type ProviderOptions = ReadonlyArray<ProviderOptionSelection>;

/**
 * All the picker reads from the prompt while rendering. Passing this instead of
 * the prompt keeps the picker from re-rendering on every keystroke.
 */
export type PromptUltrathink = "none" | "prefix" | "body";

export function readPromptUltrathink(prompt: string): PromptUltrathink {
  if (!isClaudeUltrathinkPrompt(prompt)) return "none";
  return isClaudeUltrathinkPrompt(prompt.replace(/^Ultrathink:\s*/i, "")) ? "body" : "prefix";
}

type TraitsPersistence =
  | {
      threadRef?: ScopedThreadRef;
      draftId?: DraftId;
      onModelOptionsChange?: never;
    }
  | {
      threadRef?: undefined;
      onModelOptionsChange: (nextOptions: ProviderOptions | undefined) => void;
    };

function DefaultBadge() {
  const t = useTranslate();
  return (
    <Badge variant="outline" size="sm" className="min-w-0">
      {t("chat.traits.default")}
    </Badge>
  );
}

export function getReasoningTraitStep(input: {
  provider: ProviderDriverKind;
  instanceId: ProviderInstanceId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ProviderOptions | undefined;
  reportedModelSelection: ModelSelection | null | undefined;
  prompt: string;
  planModeEnabled: boolean;
  direction: 1 | -1;
}) {
  const selected = getSelectedTraits(
    input.provider,
    input.models,
    input.model,
    readPromptUltrathink(input.prompt),
    input.modelOptions,
    true,
    input.planModeEnabled,
  );
  if (selected.modelIsUnavailable || selected.ultrathinkInBodyText) return null;
  const descriptor = selected.descriptors.find(isReasoningOption);
  if (!descriptor) return null;
  if (descriptor.type === "boolean") {
    const modelOptions = buildProviderOptionSelectionsFromDescriptors(
      replaceDescriptorCurrentValue(selected.descriptors, descriptor.id, !descriptor.currentValue),
    );
    return modelOptions ? { prompt: input.prompt, modelOptions } : null;
  }
  if (descriptor.options.length < 2) return null;
  const isPrimary = descriptor.id === selected.primarySelectDescriptor?.id;
  const current =
    isPrimary && selected.ultrathinkPromptControlled
      ? "ultrathink"
      : getDescriptorStringValue(
          descriptor,
          { instanceId: input.instanceId, model: input.model, options: input.modelOptions ?? [] },
          input.reportedModelSelection,
        );
  const ordered = input.direction > 0 ? descriptor.options : descriptor.options.toReversed();
  const position =
    [current, getDescriptorStringValue(descriptor)]
      .map((value) => ordered.findIndex((option) => option.id === value))
      .find((index) => index >= 0) ?? -1;
  for (const option of [
    ...ordered.slice(position + 1),
    ...ordered.slice(0, Math.max(position, 0)),
  ]) {
    const change = getTraitSelectChange(selected, descriptor, input.prompt, option.id);
    if (!change) return null;
    if ("modelOptions" in change) {
      return change.modelOptions
        ? { prompt: change.prompt, modelOptions: change.modelOptions }
        : null;
    }
    // A slash command refuses the Ultrathink prefix, so skip that level.
    if (change.prompt.startsWith(ULTRATHINK_PROMPT_PREFIX)) return change;
  }
  return null;
}

export { shouldRenderTraitsControls } from "./TraitsPicker.logic";
export interface TraitsMenuContentProps {
  provider: ProviderDriverKind;
  instanceId?: ProviderInstanceId;
  models: ReadonlyArray<ServerProviderModel>;
  model: string | null | undefined;
  promptUltrathink?: PromptUltrathink | undefined;
  /** Receives an edit of the live prompt; the picker never holds the prompt text itself. */
  onPromptEdit?: (edit: (prompt: string) => string) => void;
  modelOptions?: ProviderOptions | null | undefined;
  reportedModelSelection?: ModelSelection | null | undefined;
  allowPromptInjectedEffort?: boolean;
  planModeEnabled: boolean;
  triggerClassName?: string;
  isComposerOwned?: boolean;
}

export const TraitsMenuContent = memo(function TraitsMenuContentImpl({
  provider,
  instanceId,
  models,
  model,
  promptUltrathink,
  onPromptEdit,
  modelOptions,
  reportedModelSelection,
  allowPromptInjectedEffort = true,
  planModeEnabled,
  ...persistence
}: TraitsMenuContentProps & TraitsPersistence) {
  const t = useTranslate();
  const modelSelection =
    instanceId && model ? { instanceId, model, options: modelOptions ?? [] } : null;
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const updateModelOptions = (nextOptions: ProviderOptions | undefined) => {
    if ("onModelOptionsChange" in persistence) {
      persistence.onModelOptionsChange(nextOptions);
      return;
    }
    const threadTarget = persistence.threadRef ?? persistence.draftId;
    if (!threadTarget) {
      return;
    }
    setProviderModelOptions(threadTarget, provider, nextOptions, {
      ...(instanceId ? { instanceId } : {}),
      model,
      persistSticky: true,
    });
  };
  const selected = getTraitsSectionVisibility({
    provider,
    models,
    model,
    promptUltrathink,
    modelOptions,
    allowPromptInjectedEffort,
    planModeEnabled,
  });
  const {
    descriptors,
    selectDescriptors,
    booleanDescriptors,
    primarySelectDescriptor,
    ultrathinkPromptControlled,
    ultrathinkInBodyText,
    hasAnyControls,
    modelIsUnavailable,
  } = selected;
  const updateDescriptors = (nextDescriptors: ReadonlyArray<ProviderOptionDescriptor>) => {
    updateModelOptions(buildProviderOptionSelectionsFromDescriptors(nextDescriptors));
  };

  const handleSelectChange = (
    descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
    value: string,
  ) => {
    // Whether a pick applies, and the options it writes, do not depend on the prompt text.
    const change = getTraitSelectChange(selected, descriptor, "", value);
    if (!change) return;
    onPromptEdit?.(
      (prompt) => getTraitSelectChange(selected, descriptor, prompt, value)?.prompt ?? prompt,
    );
    if ("modelOptions" in change) updateModelOptions(change.modelOptions);
  };

  if (!hasAnyControls) {
    return null;
  }

  if (modelIsUnavailable) {
    return (
      <>
        {descriptors.map((descriptor, index) => {
          const value = getLocalizedProviderOptionCurrentLabel(
            descriptor,
            t,
            modelSelection,
            reportedModelSelection,
          );
          if (!value) return null;
          return (
            <div key={descriptor.id}>
              {index > 0 ? <MenuDivider /> : null}
              <MenuGroup>
                <div className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">
                  {formatProviderOptionName(descriptor, t)}
                </div>
                <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">{value}</div>
              </MenuGroup>
            </div>
          );
        })}
      </>
    );
  }

  return (
    <>
      {selectDescriptors.map((descriptor, index) => {
        const selectedValue =
          ultrathinkPromptControlled && descriptor.id === primarySelectDescriptor?.id
            ? "ultrathink"
            : (getDescriptorStringValue(descriptor, modelSelection, reportedModelSelection) ?? "");

        return (
          <div key={descriptor.id}>
            {index > 0 ? <MenuDivider /> : null}
            <MenuGroup>
              <div className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">
                {formatProviderOptionName(descriptor, t)}
              </div>
              {ultrathinkInBodyText && descriptor.id === primarySelectDescriptor?.id ? (
                <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">
                  {t("chat.traits.ultrathinkHint")}
                </div>
              ) : null}
              <MenuRadioGroup
                value={selectedValue}
                onValueChange={(value) => handleSelectChange(descriptor, value)}
              >
                {selectableProviderOptionChoices(descriptor).map((option) => (
                  <MenuRadioItem
                    key={option.id}
                    value={option.id}
                    hideIndicator
                    closeOnClick
                    disabled={ultrathinkInBodyText && descriptor.id === primarySelectDescriptor?.id}
                  >
                    <span className="flex w-full min-w-0 flex-col">
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="min-w-0 truncate">
                          {formatProviderOptionChoiceLabel(descriptor, option, t)}
                        </span>
                        {option.isDefault ? <DefaultBadge /> : null}
                      </span>
                      {option.description ? (
                        <span className="max-w-56 text-pretty text-muted-foreground/80 text-xs">
                          {formatProviderOptionDescription(option.description, t)}
                        </span>
                      ) : null}
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </div>
        );
      })}
      {booleanDescriptors.map((descriptor, index) => {
        const selectedValue = descriptor.currentValue === true ? "on" : "off";

        return (
          <div key={descriptor.id}>
            {index > 0 || selectDescriptors.length > 0 ? <MenuDivider /> : null}
            <MenuGroup>
              <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
                {formatProviderOptionName(descriptor, t)}
              </div>
              <MenuRadioGroup
                value={selectedValue}
                onValueChange={(value) => {
                  updateDescriptors(
                    replaceDescriptorCurrentValue(descriptors, descriptor.id, value === "on"),
                  );
                }}
              >
                {(["on", "off"] as const).map((value) => (
                  <MenuRadioItem key={value} value={value} hideIndicator closeOnClick>
                    <span className="flex w-full min-w-0 items-center justify-between gap-3">
                      <span>{value === "on" ? t("common.on") : t("common.off")}</span>
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </div>
        );
      })}
    </>
  );
});

export const TraitsPicker = memo(function TraitsPicker({
  provider,
  instanceId,
  models,
  model,
  promptUltrathink,
  onPromptEdit,
  modelOptions,
  reportedModelSelection,
  allowPromptInjectedEffort = true,
  planModeEnabled,
  triggerClassName,
  isComposerOwned,
  size = "sm",
  hidden = false,
  disabled = false,
  ...persistence
}: TraitsMenuContentProps &
  TraitsPersistence & {
    size?: ComposerControlSize;
    hidden?: boolean;
    disabled?: boolean;
  }) {
  const t = useTranslate();
  const composerFloatingLayerProps = useComposerMenuProps();
  const [isMenuOpen, setIsMenuOpen] = useComposerMenuState(hidden || disabled);
  const { descriptors, primarySelectDescriptor, ultrathinkPromptControlled } =
    getTraitsSectionVisibility({
      provider,
      models,
      model,
      promptUltrathink,
      modelOptions,
      allowPromptInjectedEffort,
      planModeEnabled,
    });
  if (
    !shouldRenderTraitsControls({
      provider,
      models,
      model,
      promptUltrathink,
      modelOptions,
      allowPromptInjectedEffort,
      planModeEnabled,
    })
  ) {
    return null;
  }

  const { label: triggerLabel } = buildTraitsTriggerDisplay(
    {
      provider,
      descriptors,
      primarySelectDescriptorId: primarySelectDescriptor?.id ?? null,
      ultrathinkPromptControlled,
      modelSelection:
        instanceId && model ? { instanceId, model, options: modelOptions ?? [] } : null,
      reportedModelSelection,
    },
    t,
  );
  const isCodexStyle = provider === "codex";

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        setIsMenuOpen(open && !disabled);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <ComposerControl
                  disabled={disabled}
                  aria-label={triggerLabel}
                  data-composer-shortcut={isComposerOwned ? "composer.effort" : undefined}
                  size={size}
                  className={cn(
                    isCodexStyle
                      ? "min-w-0 max-w-40 shrink justify-start overflow-hidden whitespace-nowrap sm:max-w-48"
                      : "shrink-0 whitespace-nowrap",
                    triggerClassName,
                  )}
                />
              }
            />
          }
        >
          {isCodexStyle ? (
            <span
              className={cn(
                "flex min-w-0 w-full items-center",
                size === "xs" ? "gap-1" : "gap-1.5",
              )}
            >
              <ComposerControlIcon icon={BrainIcon} size={size} className="redesign:hidden" />
              <ComposerControlIcon icon={GaugeIcon} size={size} className="hidden redesign:block" />
              <span data-composer-control-label className="min-w-0 truncate">
                {triggerLabel}
              </span>
              <ComposerControlChevron size={size} />
            </span>
          ) : (
            <>
              <ComposerControlIcon icon={BrainIcon} size={size} className="redesign:hidden" />
              <ComposerControlIcon icon={GaugeIcon} size={size} className="hidden redesign:block" />
              <span data-composer-control-label>{triggerLabel}</span>
              <ComposerControlChevron size={size} />
            </>
          )}
        </TooltipTrigger>
        <TooltipPopup side="top">{triggerLabel}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="start" {...(isComposerOwned ? composerFloatingLayerProps : {})}>
        <TraitsMenuContent
          provider={provider}
          {...(instanceId ? { instanceId } : {})}
          models={models}
          model={model}
          promptUltrathink={promptUltrathink}
          {...(onPromptEdit ? { onPromptEdit } : {})}
          modelOptions={modelOptions}
          reportedModelSelection={reportedModelSelection}
          allowPromptInjectedEffort={allowPromptInjectedEffort}
          planModeEnabled={planModeEnabled}
          {...persistence}
        />
      </MenuPopup>
    </Menu>
  );
});
