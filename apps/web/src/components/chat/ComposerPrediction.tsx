import { pendingDraftWork } from "./pendingDraftWork";
import { countPreparingComposerImages } from "./preparingComposerImages";
import { randomUUID } from "~/lib/utils";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AsyncResult } from "effect/reactivity";
import { environmentCatalog } from "../../connection/catalog";
import { useAtomValue } from "@effect/atom-react";
import {
  ComposerPredictionController,
  threadPredictionContext,
} from "@t3tools/client-runtime/composer-prediction";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { ProviderInstanceId, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import {
  composerDraftHasUserContent,
  composerTargetKey,
  type DraftId,
  useComposerDraftStore,
} from "../../composerDraftStore";
import {
  getClientSettings,
  isClientSettingsHydrated,
  subscribeClientSettings,
  subscribeClientSettingsHydration,
} from "../../hooks/useSettings";
import { i18n, useTranslate } from "../../i18n";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readThreadShell } from "../../state/entities";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { environmentThreadShells } from "../../state/threads";
import { Button } from "../ui/button";
import { ComposerBanner } from "./ComposerBanner";

export function ComposerPrediction(props: {
  readonly threadRef: ScopedThreadRef;
  readonly draftTarget: ScopedThreadRef | DraftId;
  readonly selectedInstanceId: ProviderInstanceId;
  readonly codex: boolean;
  readonly blocked: boolean;
  readonly focus: () => void;
}) {
  useTranslate();
  const commands = serverEnvironment.composer;
  const { environmentId, threadId } = props.threadRef;
  const permitted = useAtomValue(
    commands.requestPrediction.permissionAtom(props.threadRef.environmentId),
  );
  const canCancel = useAtomValue(
    commands.cancelPrediction.permissionAtom(props.threadRef.environmentId),
  );
  const read = () => {
    const store = useComposerDraftStore.getState();
    const draft = store.getComposerDraft(props.draftTarget);
    const draftKey = composerTargetKey(props.draftTarget);
    const connection = appAtomRegistry.get(
      environmentCatalog.stateAtom(props.threadRef.environmentId),
    );
    return threadPredictionContext(readThreadShell(props.threadRef), {
      enabled: isClientSettingsHydrated() && getClientSettings().codexNativePredictions,
      connectionGeneration: AsyncResult.isSuccess(connection) ? connection.value.generation : 0,
      connected:
        appAtomRegistry.get(
          environmentPresentations.presentationAtom(props.threadRef.environmentId),
        )?.connection.phase === "connected",
      permitted: appAtomRegistry.get(
        commands.requestPrediction.permissionAtom(props.threadRef.environmentId),
      ),
      selectedInstanceId: draft?.activeProvider ?? props.selectedInstanceId,
      codex: props.codex,
      blocked:
        props.blocked ||
        pendingDraftWork.has(draftKey) ||
        countPreparingComposerImages(draftKey) > 0,
      draftEmpty: !composerDraftHasUserContent(draft) && (draft?.prompt.length ?? 0) === 0,
      draftRevision:
        store.getComposerDraftRevision(props.draftTarget) + pendingDraftWork.revision(draftKey),
    });
  };
  const [controller] = useState(
    () =>
      new ComposerPredictionController({
        read: () => null,
        requestId: randomUUID,
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize native prediction work with authoritative thread, connection, settings and draft changes.
  useEffect(() => {
    const unsubscribers = [
      useComposerDraftStore.subscribe(controller.update),
      pendingDraftWork.subscribe(controller.update),
      subscribeClientSettings(controller.update),
      subscribeClientSettingsHydration(controller.update),
      appAtomRegistry.subscribe(environmentCatalog.stateAtom(environmentId), controller.update),
      appAtomRegistry.subscribe(
        environmentThreadShells.threadShellAtom(scopeThreadRef(environmentId, threadId)),
        controller.update,
      ),
      appAtomRegistry.subscribe(
        environmentPresentations.presentationAtom(environmentId),
        controller.update,
      ),
      appAtomRegistry.subscribe(
        commands.requestPrediction.permissionAtom(environmentId),
        controller.update,
      ),
    ];
    controller.update();
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      controller.dismiss();
    };
  }, [controller, commands, environmentId, threadId]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the native request reader on the committed composer state.
  useLayoutEffect(() => {
    controller.setContextReader(read);
    controller.update();
  });
  if (prediction.status === "idle" || !permitted || props.blocked) return null;
  function accept() {
    const text = controller.accept();
    if (text === null) return;
    useComposerDraftStore.getState().setPrompt(props.draftTarget, text);
    props.focus();
  }
  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root>
        <ComposerBanner.Row layout="wrap-actions">
          <ComposerBanner.Content>
            <span
              className="line-clamp-3 whitespace-pre-wrap wrap-anywhere"
              aria-label={i18n.t("prediction.suggestion")}
            >
              {prediction.status === "suggestion" ? prediction.text : i18n.t("prediction.pending")}
            </span>
          </ComposerBanner.Content>
          <ComposerBanner.Actions>
            {prediction.status === "suggestion" ? (
              <Button size="xs" variant="ghost" onClick={accept}>
                {i18n.t("prediction.accept")}
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="ghost"
              disabled={!canCancel}
              onClick={controller.dismiss}
              aria-label={i18n.t(
                prediction.status === "pending" ? "prediction.cancel" : "prediction.dismiss",
              )}
            >
              ×
            </Button>
          </ComposerBanner.Actions>
        </ComposerBanner.Row>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}
