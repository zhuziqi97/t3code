import {
  hasComposerDraftOperation,
  subscribeComposerDraftOperations,
} from "../../state/composerDraftOperations";
import { environmentCatalog } from "../../connection/catalog";
import { useAtomValue } from "@effect/atom-react";
import { useIsFocused } from "@react-navigation/native";
import {
  ComposerPredictionController,
  threadPredictionContext,
} from "@t3tools/client-runtime/composer-prediction";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useTranslate } from "../../i18n";
import { isAppActive, subscribeAppState } from "../../lib/appState";
import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentPresentations } from "../../state/presentation";
import { mobilePreferencesAtom } from "../../state/preferences";
import { serverEnvironment } from "../../state/server";
import { environmentThreadShells } from "../../state/threads";
import {
  composerContextImportsAtom,
  composerDraftsAtom,
  getComposerDraftRevision,
  getComposerDraftSnapshot,
  setComposerDraftText,
} from "../../state/use-composer-drafts";

export function ComposerPrediction(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly draftKey: string;
  readonly blocked: boolean;
  readonly focus: () => void;
}) {
  const t = useTranslate();
  const focused = useIsFocused();
  const commands = serverEnvironment.composer;
  const permitted = useAtomValue(commands.requestPrediction.permissionAtom(props.environmentId));
  const canCancel = useAtomValue(commands.cancelPrediction.permissionAtom(props.environmentId));
  const read = () => {
    const input = { ...props, focused };
    const draft = getComposerDraftSnapshot(input.draftKey);
    const ref = scopeThreadRef(input.environmentId, input.threadId);
    const thread = appAtomRegistry.get(environmentThreadShells.threadShellAtom(ref));
    const selectedInstanceId =
      draft.modelSelection?.instanceId ?? thread?.modelSelection.instanceId;
    if (!selectedInstanceId) return null;
    const preferences = appAtomRegistry.get(mobilePreferencesAtom);
    const connection = appAtomRegistry.get(environmentCatalog.stateAtom(input.environmentId));
    const config = appAtomRegistry.get(serverEnvironment.configValueAtom(input.environmentId));
    return threadPredictionContext(thread, {
      enabled:
        AsyncResult.isSuccess(preferences) && preferences.value.codexNativePredictions === true,
      connectionGeneration: AsyncResult.isSuccess(connection) ? connection.value.generation : 0,
      connected:
        appAtomRegistry.get(environmentPresentations.presentationAtom(input.environmentId))
          ?.connection.phase === "connected",
      permitted: appAtomRegistry.get(
        commands.requestPrediction.permissionAtom(input.environmentId),
      ),
      selectedInstanceId,
      codex:
        config?.providers.some(
          (provider) => provider.instanceId === selectedInstanceId && provider.driver === "codex",
        ) === true,
      blocked:
        input.blocked ||
        hasComposerDraftOperation(input.draftKey) ||
        !input.focused ||
        !isAppActive() ||
        appAtomRegistry.get(composerContextImportsAtom)[input.draftKey] === true,
      draftEmpty:
        draft.text.length === 0 &&
        draft.attachments.length === 0 &&
        (draft.context?.records.length ?? 0) === 0,
      draftRevision: getComposerDraftRevision(input.draftKey),
    });
  };
  const [controller] = useState(
    () =>
      new ComposerPredictionController({
        requestId: uuidv4,
        read: () => null,
        request: async (target) => {
          const result = await runAtomCommand(appAtomRegistry, commands.requestPrediction, target, {
            reportFailure: false,
          });
          return result._tag === "Success" ? result.value : null;
        },
        cancel: async (target) => {
          await runAtomCommand(appAtomRegistry, commands.cancelPrediction, target, {
            reportFailure: false,
          });
        },
      }),
  );
  const prediction = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  // oxlint-disable-next-line t3code/react-effect-budget -- Keep native work synchronized with the committed composer and screen focus.
  useLayoutEffect(() => {
    controller.setContextReader(read);
    controller.update();
  });
  // oxlint-disable-next-line t3code/react-effect-budget -- Cancel native work as thread, connection, preferences, draft or app activity changes.
  useEffect(() => {
    const ref = scopeThreadRef(props.environmentId, props.threadId);
    const unsubscribers = [
      appAtomRegistry.subscribe(composerDraftsAtom, controller.update),
      appAtomRegistry.subscribe(composerContextImportsAtom, controller.update),
      appAtomRegistry.subscribe(mobilePreferencesAtom, controller.update),
      appAtomRegistry.subscribe(environmentThreadShells.threadShellAtom(ref), controller.update),
      appAtomRegistry.subscribe(
        environmentPresentations.presentationAtom(props.environmentId),
        controller.update,
      ),
      appAtomRegistry.subscribe(
        commands.requestPrediction.permissionAtom(props.environmentId),
        controller.update,
      ),
      appAtomRegistry.subscribe(
        environmentCatalog.stateAtom(props.environmentId),
        controller.update,
      ),
      subscribeAppState(controller.update),
      subscribeComposerDraftOperations(controller.update),
    ];
    controller.update();
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      controller.dismiss();
    };
  }, [controller, commands, props.environmentId, props.threadId]);
  if (prediction.status === "idle" || !permitted || props.blocked || !focused) return null;
  function accept() {
    const text = controller.accept();
    if (text === null) return;
    setComposerDraftText(props.draftKey, text);
    props.focus();
  }
  return (
    <View className="gap-2 rounded-2xl bg-composer-surface p-3">
      <Text
        numberOfLines={4}
        className="text-sm text-foreground"
        accessibilityLabel={t("prediction.suggestion")}
      >
        {prediction.status === "suggestion" ? prediction.text : t("prediction.pending")}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {prediction.status === "suggestion" ? (
          <Button label={t("prediction.accept")} tone="text" onPress={accept} />
        ) : null}
        <Button
          label={t(prediction.status === "pending" ? "prediction.cancel" : "prediction.dismiss")}
          tone="text"
          disabled={!canCancel}
          onPress={controller.dismiss}
        />
      </View>
    </View>
  );
}
