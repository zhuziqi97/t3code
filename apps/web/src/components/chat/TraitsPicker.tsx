import { isReasoningOption } from "@t3tools/shared/model";
import { getSelectedTraits, getTraitsSectionVisibility } from "./TraitsPicker.logic";
import {
  buildTraitsTriggerDisplay,
  getDescriptorStringValue,
  getTraitSelectChange,
  replaceDescriptorCurrentValue,
  selectableProviderOptionChoices,
  isReasoningSelect,
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
import { GaugeIcon } from "lucide-react";
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
import { ComposerControl, ComposerControlIcon, type ComposerControlSize } from "./ComposerControl";
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

export { getTraitsSectionVisibility } from "./TraitsPicker.logic";

/**
 * `modelOptions` must already carry the composer's implicit defaults (see
 * `withImplicitFastModeDefault`) so the persisted selection matches what the
 * picker would write.
 */
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
  const descriptor = selected.selectDescriptors.find(isReasoningSelect);
  const choices = descriptor ? selectableProviderOptionChoices(descriptor) : [];
  if (!descriptor || choices.length < 2) return null;
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
    if (!change) continue;
    return change.modelOptions
      ? { prompt: change.prompt, modelOptions: change.modelOptions }
      : null;
  }
  return null;
}

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
}

export type TraitsSelectionInput = TraitsMenuContentProps & TraitsPersistence;

/** The model's traits with their shown values, and writers that persist a change. */
export function useTraitsSelection({
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
  triggerClassName: _triggerClassName,
  ...persistence
}: TraitsSelectionInput) {
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
  return {
    ...selected,
    /** The option a select shows, where an Ultrathink prompt owns the primary select. */
    selectValue: (descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>) =>
      selected.ultrathinkPromptControlled && descriptor.id === selected.primarySelectDescriptor?.id
        ? "ultrathink"
        : (getDescriptorStringValue(descriptor, modelSelection, reportedModelSelection) ?? ""),
    currentLabel: (descriptor: ProviderOptionDescriptor) =>
      getLocalizedProviderOptionCurrentLabel(descriptor, t, modelSelection, reportedModelSelection),
    changeSelect: (
      descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
      value: string,
    ) => {
      // Whether a pick applies, and the options it writes, do not depend on the prompt text.
      const change = getTraitSelectChange(selected, descriptor, "", value);
      if (!change) return;
      onPromptEdit?.(
        (prompt) => getTraitSelectChange(selected, descriptor, prompt, value)?.prompt ?? prompt,
      );
      updateModelOptions(change.modelOptions);
    },
    changeBoolean: (descriptorId: string, value: boolean) => {
      updateModelOptions(
        buildProviderOptionSelectionsFromDescriptors(
          replaceDescriptorCurrentValue(selected.descriptors, descriptorId, value),
        ),
      );
    },
  };
}

const TraitsMenuContent = memo(function TraitsMenuContentImpl(props: TraitsSelectionInput) {
  const t = useTranslate();
  const traits = useTraitsSelection(props);
  const {
    descriptors,
    selectDescriptors,
    booleanDescriptors,
    primarySelectDescriptor,
    ultrathinkInBodyText,
    hasAnyControls,
    modelIsUnavailable,
  } = traits;

  if (!hasAnyControls) {
    return null;
  }

  if (modelIsUnavailable) {
    return (
      <>
        {descriptors.map((descriptor, index) => {
          const value = traits.currentLabel(descriptor);
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
      {selectDescriptors.map((descriptor, index) => (
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
              value={traits.selectValue(descriptor)}
              onValueChange={(value) => traits.changeSelect(descriptor, value)}
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
      ))}
      {booleanDescriptors.map((descriptor, index) => (
        <div key={descriptor.id}>
          {index > 0 || selectDescriptors.length > 0 ? <MenuDivider /> : null}
          <MenuGroup>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
              {formatProviderOptionName(descriptor, t)}
            </div>
            <MenuRadioGroup
              value={descriptor.currentValue === true ? "on" : "off"}
              onValueChange={(value) => traits.changeBoolean(descriptor.id, value === "on")}
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
      ))}
    </>
  );
});

export const TraitsPicker = memo(function TraitsPicker({
  size = "sm",
  hidden = false,
  disabled = false,
  ...props
}: TraitsSelectionInput & {
  size?: ComposerControlSize;
  hidden?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslate();
  const [isMenuOpen, setIsMenuOpen] = useComposerMenuState(hidden || disabled);
  const traits = useTraitsSelection(props);
  if (!traits.hasAnyControls) {
    return null;
  }
  const { label: triggerLabel } = buildTraitsTriggerDisplay(
    {
      provider: props.provider,
      descriptors: traits.descriptors,
      primarySelectDescriptorId: traits.primarySelectDescriptor?.id ?? null,
      ultrathinkPromptControlled: traits.ultrathinkPromptControlled,
      modelSelection:
        props.instanceId && props.model
          ? { instanceId: props.instanceId, model: props.model, options: props.modelOptions ?? [] }
          : null,
      reportedModelSelection: props.reportedModelSelection,
    },
    t,
  );
  const isCodexStyle = props.provider === "codex";

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
                  size={size}
                  className={cn(
                    isCodexStyle
                      ? "min-w-0 max-w-40 shrink justify-start overflow-hidden whitespace-nowrap sm:max-w-48"
                      : "shrink-0 whitespace-nowrap",
                    props.triggerClassName,
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
              <ComposerControlIcon icon={GaugeIcon} size={size} />
              <span data-composer-control-label className="min-w-0 truncate">
                {triggerLabel}
              </span>
            </span>
          ) : (
            <>
              <ComposerControlIcon icon={GaugeIcon} size={size} />
              <span data-composer-control-label>{triggerLabel}</span>
            </>
          )}
        </TooltipTrigger>
        <TooltipPopup side="top">{triggerLabel}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="start">
        <TraitsMenuContent {...props} />
      </MenuPopup>
    </Menu>
  );
});
