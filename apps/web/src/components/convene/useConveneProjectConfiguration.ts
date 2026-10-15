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
import { useCallback, useEffect, useRef, useState } from "react";
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
  const current = useRef({ configuration, draft });
  useEffect(() => {
    current.current = { configuration, draft };
  }, [configuration, draft]);
  const keyFor = useCallback(
    (value: ConveneProjectConfiguration) =>
      `convene-draft:${environmentId}:${projectId}:${value.client_project_id}`,
    [environmentId, projectId],
  );
  const accept = useCallback(
    (value: ConveneProjectConfiguration, saved = false) => {
      const previous = current.current;
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
            : (readConveneDraft(keyFor(value)) ?? configurationDraft(value))),
      );
      if (saved) writeConveneDraft(keyFor(value), null);
    },
    [keyFor],
  );
  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await query({ environmentId, input: { projectId } });
    setBusy(false);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : t("convene.error.load"));
      setFresh(false);
      return;
    }
    setFresh(result.value.fresh);
    setError(result.value.error);
    if (result.value.configuration) accept(result.value.configuration);
    else {
      setConfiguration(null);
      setDraft(null);
    }
  }, [query, environmentId, projectId, accept, t]);
  useEffect(() => {
    void refresh();
  }, [refresh, online]);
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
    const result = await mutate({ environmentId, input });
    setBusy(false);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : t("convene.error.save"));
      return false;
    }
    accept(result.value, input.operation === "save");
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
    busy,
    error,
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
    canWrite: online && fresh && permitted && !busy,
  };
}
