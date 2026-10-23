import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { Atom, AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";
import {
  conveneComposerTarget,
  conveneGuidelineStatus,
  createConveneComposerSearch,
  matchesConveneGuideline,
  sameConveneComposerTarget,
  type ConveneComposerCommandItem,
  type ConveneComposerSearchState,
} from "@t3tools/client-runtime/convene-composer";
import { conveneResourceTransportFailure } from "@t3tools/client-runtime/convene-resource-reader";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useTranslate } from "../../i18n";
import { conveneEnvironment } from "../../state/convene";
import { useAtomCommand } from "../../state/use-atom-command";
import { useDebouncedValue } from "../../state/queries";

const DENIED = Atom.make(false);
const NO_CHANGES = Atom.make(AsyncResult.success(0));
const DISCONNECTED = Atom.make(AsyncResult.initial<never, never>(false));

export function useConveneComposerSearch(input: {
  environmentId: EnvironmentId | null;
  projectId: ProjectId | null;
  threadId?: ThreadId | null;
  trigger: { kind: string; query: string } | null;
}) {
  const t = useTranslate();
  const permitted = useAtomValue(
    input.environmentId
      ? conveneEnvironment.searchResources.permissionAtom(input.environmentId)
      : DENIED,
  );
  const connection = useAtomValue(
    input.environmentId
      ? conveneEnvironment.status({ environmentId: input.environmentId, input: {} })
      : DISCONNECTED,
  );
  const phase = AsyncResult.isSuccess(connection) ? connection.value.phase : null;
  const { environmentId, projectId } = input;
  const kind = input.trigger?.kind;
  const query = input.trigger?.query ?? "";
  const target = conveneComposerTarget(environmentId, projectId, kind ? { kind, query } : null);
  const settledTarget = useDebouncedValue(target, 180);
  const changes = useAtomValue(
    target && input.threadId && permitted
      ? conveneEnvironment.resourceChanges({
          environmentId: target.environmentId,
          input: { threadId: input.threadId },
        })
      : NO_CHANGES,
  );
  const revision = AsyncResult.isSuccess(changes) ? changes.value : 0;
  const search = useAtomCommand(conveneEnvironment.searchResources, { reportFailure: false });
  const project = useAtomCommand(conveneEnvironment.queryProject, { reportFailure: false });
  const [state, setState] = useState<ConveneComposerSearchState>({
    target: null,
    pending: false,
    result: null,
    page: 1,
  });
  const [reader] = useState(() =>
    createConveneComposerSearch(async (location, page) => {
      if (location.kind === "guideline") {
        const response = await project({
          environmentId: location.environmentId,
          input: { projectId: location.projectId },
        });
        if (response._tag === "Failure") return { status: "unavailable" };
        const status = conveneGuidelineStatus(response.value.fresh, response.value.configuration);
        return status === "ready"
          ? { status, items: [], total: 0, page: 1, page_size: 20 }
          : { status };
      }
      const response = await search({
        environmentId: location.environmentId,
        input: {
          projectId: location.projectId,
          kind: location.kind,
          query: location.query,
          page,
          pageSize: 20,
        },
      });
      if (response._tag === "Success") return response.value;
      const failed = conveneResourceTransportFailure("", squashAtomCommandFailure(response));
      return { status: failed.status === "unauthorized" ? "unauthorized" : "unavailable" };
    }, setState),
  );
  useEffect(() => {
    if (settledTarget && permitted && phase === "online") void reader.load(settledTarget);
    return reader.clear;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Permission notifications invalidate candidates even when the search target is unchanged.
  }, [reader, settledTarget, permitted, phase, revision]);
  const current =
    sameConveneComposerTarget(target, settledTarget) &&
    sameConveneComposerTarget(target, state.target);
  const pending = target !== null && permitted && phase === "online" && (!current || state.pending);
  const result = current && !state.pending ? state.result : null;
  const ready = permitted && phase === "online" && result?.status === "ready" ? result : null;
  const items: ConveneComposerCommandItem[] =
    !target || !ready
      ? []
      : target.kind === "guideline"
        ? matchesConveneGuideline(target.query)
          ? [
              {
                type: "convene-guideline",
                id: "convene:guideline",
                label: "Convene",
                description: t("convene.composer.guideline"),
                target,
              },
            ]
          : []
        : ready.items.map((resource) => ({
            type: "convene-resource",
            resource,
            id: `convene:${resource.resource_uri}`,
            label:
              resource.kind === "issue" ? `Convene #${resource.number}` : resource.relative_path,
            description: `${resource.module_path} · ${resource.title}`,
            target,
          }));
  const status = !permitted
    ? "unauthorized"
    : phase !== "online"
      ? "disconnected"
      : (result?.status ?? null);
  return {
    target,
    items,
    pending,
    message:
      target === null
        ? null
        : pending
          ? t("convene.composer.loading")
          : status === "ready"
            ? t("convene.composer.scope")
            : status
              ? t(`convene.composer.${status}`)
              : null,
    previousPage:
      ready && state.page > 1
        ? () => {
            if (target) void reader.load(target, state.page - 1);
          }
        : null,
    nextPage:
      ready && state.page * ready.page_size < ready.total
        ? () => {
            if (target) void reader.load(target, state.page + 1);
          }
        : null,
    refresh:
      target && permitted && phase === "online"
        ? () => {
            void reader.load(target);
          }
        : null,
  };
}
