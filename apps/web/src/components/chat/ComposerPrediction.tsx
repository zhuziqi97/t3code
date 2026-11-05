import { pendingDraftWork } from "./pendingDraftWork";
import { countPreparingComposerImages } from "./preparingComposerImages";
import { randomUUID } from "~/lib/utils";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AsyncResult } from "effect/reactivity";
import { environmentCatalog } from "../../connection/catalog";
import { useAtomValue } from "@effect/atom-react";
import {
  ComposerPredictionController,
  type PredictionView,
  threadPredictionContext,
} from "@t3tools/client-runtime/composer-prediction";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { ProviderInstanceId, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { useTranslate } from "../../i18n";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readThreadShell } from "../../state/entities";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { environmentThreadShells } from "../../state/threads";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogPanel,
  DialogHeader,
  DialogFooter,
} from "../ui/dialog";

export function useComposerPrediction(props: {
  readonly threadRef: ScopedThreadRef;
  readonly draftTarget: ScopedThreadRef | DraftId;
  readonly selectedInstanceId: ProviderInstanceId;
  readonly codex: boolean;
  readonly blocked: boolean;
}) {
  const commands = serverEnvironment.composer;
  const { environmentId, threadId } = props.threadRef;
  const permitted = useAtomValue(
    commands.requestPrediction.permissionAtom(props.threadRef.environmentId),
  );
  const draftKey = composerTargetKey(props.draftTarget);
  const read = () => {
    const store = useComposerDraftStore.getState();
    const draft = store.getComposerDraft(props.draftTarget);
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
  const createController = () =>
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
    });
  const [state, setState] = useState(() => ({ key: draftKey, controller: createController() }));
  let controller = state.controller;
  if (state.key !== draftKey) {
    controller = createController();
    setState({ key: draftKey, controller });
  }
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
  return {
    view: !permitted || props.blocked ? ({ status: "idle", text: null } as const) : prediction,
    accept: controller.accept,
    dismiss: controller.dismiss,
  };
}

export function ComposerPrediction(props: {
  readonly view: PredictionView;
  readonly accept: () => boolean;
  readonly dismiss: () => void;
}) {
  const t = useTranslate();
  const prediction = props.view;
  if (prediction.status === "idle") return null;
  return (
    <div
      className="flex flex-wrap items-center gap-1 pt-1 text-xs text-muted-foreground"
      data-composer-prediction={prediction.status}
    >
      <span role="status" className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
        {prediction.status === "suggestion"
          ? t("prediction.ready")
          : t(`prediction.${prediction.status}`)}
      </span>
      {prediction.status === "suggestion" ? (
        <PredictionSuggestion text={prediction.text} accept={props.accept} />
      ) : null}
      <Button
        size="xs"
        variant="ghost"
        onClick={props.dismiss}
        aria-label={t(prediction.status === "pending" ? "prediction.cancel" : "prediction.dismiss")}
      >
        {t(prediction.status === "pending" ? "prediction.cancel" : "prediction.dismiss")}
      </Button>
    </div>
  );
}

function PredictionSuggestion(props: { readonly text: string; readonly accept: () => boolean }) {
  const t = useTranslate();
  const [expanded, setExpanded] = useState(false);
  const accepted = useRef(false);
  return (
    <>
      <Button size="xs" variant="ghost" onClick={props.accept}>
        {t("prediction.accept")}
      </Button>
      <Button size="xs" variant="ghost" onClick={() => setExpanded(true)}>
        {t("prediction.view")}
      </Button>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogPopup finalFocus={() => !accepted.current}>
          <DialogHeader>
            <DialogTitle>{t("prediction.suggestion")}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <p className="whitespace-pre-wrap wrap-anywhere">{props.text}</p>
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExpanded(false)}>
              {t("prediction.collapse")}
            </Button>
            <Button
              onClick={() => {
                accepted.current = true;
                if (!props.accept()) accepted.current = false;
              }}
            >
              {t("prediction.accept")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
