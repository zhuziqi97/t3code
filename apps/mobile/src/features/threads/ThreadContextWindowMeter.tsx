import { useAtomValue } from "@effect/atom-react";
import {
  deriveThreadContextWindowSnapshot,
  formatContextWindowPercentage,
  formatContextWindowTokens,
} from "@t3tools/client-runtime/contextWindow";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { Pressable } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { useTranslate } from "../../i18n";
import { mobilePreferencesAtom } from "../../state/preferences";
import { useThreadProjection } from "../../state/use-thread-detail";

export function ThreadContextWindowMeter(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const t = useTranslate();
  const thread = useThreadProjection(props);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const usage = deriveThreadContextWindowSnapshot(thread?.projection);
  if (
    !AsyncResult.isSuccess(preferences) ||
    preferences.value.contextWindowMeterEnabled === false
  ) {
    return null;
  }
  const summary = t("chat.context.summary", {
    used: usage === null ? t("chat.context.unknown") : formatContextWindowTokens(usage.usedTokens),
    limit:
      usage?.maxTokens == null
        ? t("chat.context.unknown")
        : formatContextWindowTokens(usage.maxTokens),
    percent:
      formatContextWindowPercentage(usage?.usedPercentage ?? null) ?? t("chat.context.unknown"),
  });
  const details = [
    summary,
    ...(usage?.totalProcessedTokens != null
      ? [`${t("chat.context.processed")}: ${formatContextWindowTokens(usage.totalProcessedTokens)}`]
      : []),
    ...(usage?.cost != null
      ? [`${t("chat.context.cost")}: ${usage.cost.currency} ${usage.cost.amount}`]
      : []),
  ].join("\n");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("chat.context.window")}
      onPress={() => Dialog.alert(t("chat.context.window"), details)}
      className="self-end px-2 py-1"
    >
      <Text className="text-xs tabular-nums text-foreground-muted">{summary}</Text>
    </Pressable>
  );
}
