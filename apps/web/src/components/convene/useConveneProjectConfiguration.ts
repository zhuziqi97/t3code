import { toastManager } from "../ui/toast";
import { useTranslate } from "../../i18n";
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  ConveneProjectMutation,
  ConveneProjectConfiguration,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";
import { useStableCallback } from "../../hooks/useStableCallback";
import { conveneEnvironment } from "~/state/convene";
import { useAtomCommand } from "~/state/use-atom-command";
import { useConveneStatus } from "./ConveneConnectionPanel";
import {
  configurationDraft,
  readConveneDraft,
  sameConveneDraft,
  writeConveneDraft,
  type ConveneDraft,
} from "./conveneDraft";

export function useConveneProjectConfiguration(environmentId: EnvironmentId, projectId: ProjectId) {
  const t = useTranslate();
  const statusResult = useConveneStatus(environmentId);
  const online = AsyncResult.isSuccess(statusResult) && statusResult.value.phase === "online";
  const permitted = useAtomValue(conveneEnvironment.mutateProject.permissionAtom(environmentId));
  const query = useAtomCommand(conveneEnvironment.queryProject, { reportFailure: false });
  const mutate = useAtomCommand(conveneEnvironment.mutateProject, { reportFailure: false });
  const [configuration, setConfiguration] = useState<ConveneProjectConfiguration | null>(null);
  const [draft, setDraft] = useState<ConveneDraft | null>(null);
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastOperation, setLastOperation] = useState<ConveneProjectMutation | null>(null);
  const keyFor = (value: ConveneProjectConfiguration) =>
    `convene-draft:${environmentId}:${projectId}:${value.client_project_id}`;
  const accept = useStableCallback(
    (value: ConveneProjectConfiguration, saved: boolean, storageKey: string) => {
      const previous = { configuration, draft };
      const preserved =
        !saved &&
        previous.configuration?.client_project_id === value.client_project_id &&
        previous.draft &&
        !sameConveneDraft(previous.draft, configurationDraft(previous.configuration))
          ? previous.draft
          : null;
      setConfiguration(value);
      setDraft(
        preserved ??
          (saved
            ? configurationDraft(value)
            : (readConveneDraft(storageKey) ?? configurationDraft(value))),
      );
      if (saved) writeConveneDraft(storageKey, null);
    },
  );
  const refreshContext = { environmentId, projectId, online, query, t };
  const [loadedContext, setLoadedContext] = useState<typeof refreshContext | null>(null);
  const loading =
    loadedContext?.environmentId !== environmentId ||
    loadedContext.projectId !== projectId ||
    loadedContext.online !== online ||
    loadedContext.query !== query ||
    loadedContext.t !== t;
  const completeLoad = useStableCallback(
    (context: typeof refreshContext, result: Awaited<ReturnType<typeof query>>) => {
      if (
        context.environmentId !== environmentId ||
        context.projectId !== projectId ||
        context.online !== online ||
        context.query !== query ||
        context.t !== t
      )
        return;
      setLoadedContext(context);
      setBusy(false);
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : t("convene.error.load"));
        setFresh(false);
        return;
      }
      setFresh(result.value.fresh);
      setError(result.value.error);
      if (result.value.configuration)
        accept(
          result.value.configuration,
          false,
          `convene-draft:${environmentId}:${projectId}:${result.value.configuration.client_project_id}`,
        );
      else {
        setConfiguration(null);
        setDraft(null);
      }
    },
  );
  const load = useStableCallback(async (context: typeof refreshContext) => {
    const result = await context.query({
      environmentId: context.environmentId,
      input: { projectId: context.projectId },
    });
    completeLoad(context, result);
  });
  const refresh = () => {
    setBusy(true);
    setError(null);
    return load(refreshContext);
  };
  // oxlint-disable-next-line t3code/react-effect-budget -- Connection transitions invalidate the remote project configuration without discarding its local draft.
  useEffect(() => {
    void load({ environmentId, projectId, online, query, t });
  }, [load, environmentId, projectId, online, query, t]);
  const edit = (value: ConveneDraft) => {
    setDraft(value);
    if (configuration) {
      try {
        writeConveneDraft(
          keyFor(configuration),
          sameConveneDraft(value, configurationDraft(configuration)) ? null : value,
        );
      } catch {
        setError(t("convene.error.draft"));
      }
    }
  };
  const run = async (input: ConveneProjectMutation) => {
    if (!online || !fresh || !permitted) return false;
    setBusy(true);
    setError(null);
    setLastOperation(input);
    const mcpWasEnabled = configuration?.mcp_enabled;
    const result = await mutate({ environmentId, input });
    setBusy(false);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : t("convene.error.save"));
      return false;
    }
    if (input.operation === "save" && !mcpWasEnabled && result.value.mcp_enabled) {
      toastManager.add({ type: "success", title: t("convene.project.mcpEnabled") });
    }
    accept(result.value, input.operation === "save", keyFor(result.value));
    setLastOperation(null);
    return true;
  };
  const dirty =
    configuration !== null &&
    draft !== null &&
    !sameConveneDraft(draft, configurationDraft(configuration));
  const save = () => {
    if (draft && dirty)
      return run({
        operation: "save",
        projectId,
        mcp_enabled: draft.enabled,
        mcp_scope_modules: draft.scope,
        mcp_capabilities: draft.capabilities,
      });
    return Promise.resolve(!dirty);
  };
  const discard = () => {
    if (configuration) edit(configurationDraft(configuration));
  };
  return {
    configuration,
    draft,
    dirty,
    fresh,
    busy: busy || loading,
    error: loading ? null : error,
    online,
    needsConnection:
      AsyncResult.isSuccess(statusResult) &&
      (statusResult.value.phase === "unpaired" || statusResult.value.phase === "offline"),
    permitted,
    lastOperation,
    refresh,
    edit,
    run,
    save,
    discard,
    canWrite: online && fresh && permitted && !busy && !loading,
  };
}
