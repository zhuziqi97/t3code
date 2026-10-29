import {
  resolveProviderSkillSourceKind,
  type ProviderSkillSourceKind,
} from "@t3tools/client-runtime/providerSkills";
import type {
  EnvironmentId,
  EnvironmentMachineKind,
  PullRequestContextMetadata,
  ScopedThreadRef,
  ServerProviderSkill,
  ServerProviderSlashCommand,
} from "@t3tools/contracts";
import type { ComposerTriggerKind } from "@t3tools/shared/composerTrigger";
import { memo } from "react";
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ENVIRONMENT_MACHINE_SYMBOLS } from "../../components/EnvironmentMachineSymbol";
import { GlassSurface } from "../../components/ui/GlassSurface";
import { PierreEntryIcon } from "../../components/PierreEntryIcon";
import { pullRequestStatus } from "../pull-requests/pullRequestStatus";
import { useTranslate } from "../../i18n";
import type {
  ConveneComposerCommandItem,
  ConveneComposerFooter,
} from "@t3tools/client-runtime/convene-composer";
export type ComposerCommandItem =
  | ConveneComposerCommandItem
  | {
      readonly id: string;
      readonly type: "pull-request";
      readonly pullRequest: PullRequestContextMetadata;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "path";
      readonly path: string;
      readonly kind: "file" | "directory";
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "thread";
      readonly thread: ScopedThreadRef;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "environment";
      readonly environmentId: EnvironmentId;
      readonly machine: EnvironmentMachineKind;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "slash-command";
      readonly command: string;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "provider-slash-command";
      readonly command: ServerProviderSlashCommand;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "skill";
      readonly skill: ServerProviderSkill;
      readonly label: string;
      readonly description: string;
    };

interface ComposerCommandPopoverProps {
  readonly items: ReadonlyArray<ComposerCommandItem>;
  readonly triggerKind: ComposerTriggerKind | null;
  readonly isLoading: boolean;
  readonly error?: string | null;
  readonly onSelect: (item: ComposerCommandItem) => void;
  readonly conveneSearch?: ConveneComposerFooter;
}

function PopoverSurface(props: { readonly children: React.ReactNode; readonly style?: ViewStyle }) {
  const baseStyle: ViewStyle = {
    borderRadius: 16,
    overflow: "hidden",
    ...props.style,
  };

  return (
    <GlassSurface
      glassEffectStyle="clear"
      tintColorClassName="accent-glass-surface"
      style={baseStyle}
    >
      {props.children}
    </GlassSurface>
  );
}

const SKILL_SOURCE_SYMBOL_BY_KIND: Record<ProviderSkillSourceKind, AppSymbolName> = {
  app: "square.grid.2x2",
  repo: "folder",
  project: "folder",
  personal: "person.crop.circle",
  system: "gearshape",
  other: "cube",
};

function itemIcon(item: ComposerCommandItem): AppSymbolName | null {
  switch (item.type) {
    case "convene-resource":
      return item.resource.kind === "issue" ? "text.bubble" : "doc.text";
    case "convene-guideline":
      return "doc.text";
    case "pull-request":
      return pullRequestStatus(item.pullRequest).icon;
    case "slash-command":
    case "provider-slash-command":
      return "terminal";
    case "skill":
      return SKILL_SOURCE_SYMBOL_BY_KIND[resolveProviderSkillSourceKind(item.skill)];
    case "path":
      return null;
    case "thread":
      return "text.bubble";
    case "environment":
      return ENVIRONMENT_MACHINE_SYMBOLS[item.machine];
  }
}

function groupLabel(triggerKind: ComposerTriggerKind | null): string | null {
  switch (triggerKind) {
    case "pull-request":
      return "Pull requests";
    case "slash-command":
      return "Commands";
    case "skill":
      return "Skills";
    case "path":
      return "Files";
    default:
      return null;
  }
}

function emptyText(triggerKind: ComposerTriggerKind | null, isLoading: boolean): string {
  if (isLoading) {
    return triggerKind === "path" ? "Searching files…" : "Loading…";
  }
  switch (triggerKind) {
    case "pull-request":
      return "No matching pull requests.";
    case "path":
      return "No matching files or folders.";
    case "skill":
      return "No skills found.";
    case "slash-command":
      return "No matching commands.";
    default:
      return "No results.";
  }
}

const CommandRow = memo(function CommandRow(props: {
  readonly item: ComposerCommandItem;
  readonly onPress: () => void;
  readonly isLast: boolean;
  readonly isSlashSkill: boolean;
}) {
  const t = useTranslate();
  const iconName = itemIcon(props.item);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      className="flex-row items-center gap-2.5 border-border px-3.5 py-2.5 active:opacity-60"
      style={{ borderBottomWidth: props.isLast ? 0 : StyleSheet.hairlineWidth }}
    >
      {props.item.type === "path" ? (
        <PierreEntryIcon path={props.item.path} kind={props.item.kind} size={16} />
      ) : iconName ? (
        <SymbolView
          name={iconName}
          size={14}
          tintColorClassName={
            props.item.type === "pull-request"
              ? pullRequestStatus(props.item.pullRequest).tint
              : "accent-icon-subtle"
          }
          type="monochrome"
        />
      ) : null}
      {props.item.type === "convene-resource" ? (
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text
              className="min-w-0 flex-1 text-base font-t3-medium text-foreground"
              numberOfLines={1}
            >
              {props.item.label}
            </Text>
            {props.item.resource.kind === "issue" ? (
              <Text className="shrink-0 text-xs text-foreground-muted">
                {t(
                  props.item.resource.state === "OPEN"
                    ? "convene.resource.issueStateOpen"
                    : "convene.resource.issueStateClosed",
                )}
              </Text>
            ) : null}
          </View>
          <Text className="text-xs text-foreground" numberOfLines={1}>
            {props.item.resource.title}
          </Text>
          <Text className="text-xs text-foreground-muted" numberOfLines={1}>
            {props.item.resource.module_path}
          </Text>
        </View>
      ) : (
        <>
          <Text className="shrink-0 text-base font-t3-medium text-foreground" numberOfLines={1}>
            {props.isSlashSkill && props.item.type === "skill" ? (
              <>
                <Text className="text-foreground-muted">skill:</Text>
                {props.item.skill.name}
              </>
            ) : (
              props.item.label
            )}
          </Text>
          {props.item.description ? (
            <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
              {props.item.description}
            </Text>
          ) : null}
        </>
      )}
    </Pressable>
  );
});

export const ComposerCommandPopover = memo(function ComposerCommandPopover(
  props: ComposerCommandPopoverProps,
) {
  const t = useTranslate();
  const label = groupLabel(props.triggerKind);

  return (
    <PopoverSurface>
      {label ? (
        <View className="px-3.5 pt-2.5 pb-1">
          <Text className="text-3xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
            {label}
          </Text>
        </View>
      ) : null}
      {props.items.length > 0 ? (
        <ScrollView
          className="max-h-[180px]"
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
        >
          {props.items.map((item, index) => (
            <CommandRow
              key={item.id}
              item={item}
              onPress={() => props.onSelect(item)}
              isLast={index === props.items.length - 1}
              isSlashSkill={props.triggerKind === "slash-command" && item.type === "skill"}
            />
          ))}
        </ScrollView>
      ) : (
        <View className="px-3.5 py-2.5">
          <Text className="text-xs text-foreground-tertiary">
            {props.error ?? emptyText(props.triggerKind, props.isLoading)}
          </Text>
        </View>
      )}
      {props.conveneSearch?.message ? (
        <View className="gap-2 border-t border-border px-3.5 py-2.5">
          <Text className="text-xs text-foreground-muted">{props.conveneSearch.message}</Text>
          <View className="flex-row flex-wrap gap-3">
            {props.conveneSearch.previousPage ? (
              <Pressable accessibilityRole="button" onPress={props.conveneSearch.previousPage}>
                <Text className="text-xs text-foreground">{t("convene.composer.previous")}</Text>
              </Pressable>
            ) : null}
            {props.conveneSearch.nextPage ? (
              <Pressable accessibilityRole="button" onPress={props.conveneSearch.nextPage}>
                <Text className="text-xs text-foreground">{t("convene.composer.next")}</Text>
              </Pressable>
            ) : null}
            {props.conveneSearch.refresh ? (
              <Pressable
                accessibilityRole="button"
                disabled={props.conveneSearch.pending}
                onPress={props.conveneSearch.refresh}
              >
                <Text className="text-xs text-foreground">{t("convene.composer.refresh")}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </PopoverSurface>
  );
});
