import { useStableCallback } from "../../hooks/useStableCallback";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  conveneResourceTransportFailure,
  createConveneResourceReader,
  type ConveneResourceReaderState,
} from "@t3tools/client-runtime/convene-resource-reader";
import { useEffect, useState } from "react";
import { AsyncResult } from "effect/reactivity";
import { useTranslate } from "../../i18n";
import { conveneEnvironment } from "../../state/convene";
import { useAtomCommand } from "../../state/use-atom-command";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { readLocalApi } from "../../localApi";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { useConveneResourceStore } from "./conveneResourceStore";

function ResourceDetail({ threadRef, uri }: { threadRef: ScopedThreadRef; uri: string }) {
  const t = useTranslate();
  const permitted = useAtomValue(
    conveneEnvironment.readResource.permissionAtom(threadRef.environmentId),
  );
  const connection = useAtomValue(
    conveneEnvironment.status({ environmentId: threadRef.environmentId, input: {} }),
  );
  const phase = AsyncResult.isSuccess(connection) ? connection.value.phase : undefined;
  const changes = useAtomValue(
    conveneEnvironment.resourceChanges({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const revision = AsyncResult.isSuccess(changes) ? changes.value : 0;
  const command = useAtomCommand(conveneEnvironment.readResource, { reportFailure: false });
  const [state, setState] = useState<ConveneResourceReaderState>({
    uri,
    pending: true,
    result: null,
  });
  const read = useStableCallback(async (target: string, page: number) => {
    const response = await command({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, uri: target, page },
    });
    return response._tag === "Success"
      ? response.value
      : conveneResourceTransportFailure(target, squashAtomCommandFailure(response));
  });
  const [reader] = useState(() => createConveneResourceReader(read, setState));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- URI and permission pushes invalidate remote reads; cleanup rejects late responses.
  useEffect(() => {
    if (permitted && phase !== "offline" && phase !== "unpaired") void reader.load(uri);
    return reader.clear;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Permission notifications invalidate the resource even when its URI is unchanged.
  }, [reader, uri, permitted, phase, revision]);
  const result = !permitted
    ? { status: "unauthorized" as const, resource_uri: uri }
    : phase === "offline" || phase === "unpaired"
      ? { status: "disconnected" as const, resource_uri: uri }
      : state.result;
  const ready = result?.status === "ready" ? result : null;
  const open = useConveneResourceStore((s) => s.open);
  return (
    <>
      <div className="flex flex-wrap gap-2 border-b p-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void writeTextToClipboard(ready?.resource_uri ?? uri, "link")}
        >
          {t("convene.resource.copyLink")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={state.pending}
          onClick={() => void reader.load(uri)}
        >
          {t("convene.resource.refresh")}
        </Button>
        {ready && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void readLocalApi()?.shell.openExternal(ready.web_url)}
          >
            {t("convene.resource.openPlatform")}
          </Button>
        )}
      </div>
      <div key={uri} className="min-h-0 flex-1 overflow-auto p-4">
        <p className="mb-4 break-all text-xs text-muted-foreground">{uri}</p>
        {state.pending && permitted && <p role="status">{t("convene.resource.loading")}</p>}
        {result && result.status !== "ready" && (
          <p role="alert">{t(`convene.resource.${result.status}`)}</p>
        )}
        {ready && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">
                #{ready.issue.number} {ready.issue.title}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t(
                  ready.issue.state === "OPEN"
                    ? "convene.resource.issueStateOpen"
                    : "convene.resource.issueStateClosed",
                )}
              </p>
            </div>
            {ready.focused_comment_number !== null && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => open(threadRef, ready.issue.resource_uri)}
              >
                {t("convene.resource.viewIssue")}
              </Button>
            )}
            {ready.issue.body !== undefined && (
              <ChatMarkdown text={ready.issue.body} cwd={undefined} threadRef={threadRef} />
            )}
            {ready.comments.map((comment) => (
              <article
                key={comment.number}
                id={`convene-comment-${comment.number}`}
                className={
                  comment.number === ready.focused_comment_number
                    ? "rounded-lg border border-primary bg-primary/5 p-3"
                    : "border-t pt-4"
                }
              >
                <a
                  href={comment.resource_uri}
                  className="text-sm font-medium text-primary"
                  onClick={(event) => {
                    event.preventDefault();
                    open(threadRef, comment.resource_uri);
                  }}
                >
                  {t("convene.resource.comment", { number: comment.number })}
                </a>
                {comment.is_deleted ? (
                  <p className="mt-2 text-muted-foreground">{t("convene.resource.deleted")}</p>
                ) : (
                  <ChatMarkdown text={comment.body ?? ""} cwd={undefined} threadRef={threadRef} />
                )}
              </article>
            ))}
            {ready.focused_comment_number === null &&
              ready.page * ready.page_size < ready.total && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={state.pending}
                  onClick={() => void reader.load(uri, ready.page + 1)}
                >
                  {t("convene.resource.moreComments")}
                </Button>
              )}
          </div>
        )}
      </div>
    </>
  );
}

/** Mount beside the chat; the narrow overlay keeps the chat and composer mounted. */
export function ConveneResourceViewer({ threadRef }: { threadRef: ScopedThreadRef }) {
  const t = useTranslate();
  const target = useConveneResourceStore((s) => s.target);
  const close = useConveneResourceStore((s) => s.close);
  if (
    !target ||
    target.threadRef.environmentId !== threadRef.environmentId ||
    target.threadRef.threadId !== threadRef.threadId
  )
    return null;
  return (
    <aside
      aria-label={t("convene.resource.title")}
      className="absolute inset-0 z-30 flex min-h-0 min-w-0 flex-col border-l bg-background lg:static lg:z-auto lg:w-[45%] lg:max-w-2xl lg:shrink-0"
    >
      <header className="flex items-center justify-between border-b p-3">
        <h2 className="font-semibold">{t("convene.resource.title")}</h2>
        <Button variant="ghost" size="sm" onClick={close}>
          {t("convene.resource.back")}
        </Button>
      </header>
      <ResourceDetail
        key={`${target.threadRef.environmentId}:${target.threadRef.threadId}`}
        threadRef={target.threadRef}
        uri={target.uri}
      />
    </aside>
  );
}
