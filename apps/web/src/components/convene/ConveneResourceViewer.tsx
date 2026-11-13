import { useEffect, useLayoutEffect, useRef } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ConveneResourceSurface } from "../../rightPanelStore";
import { useRightPanelStore } from "../../rightPanelStore";
import { useTranslate } from "../../i18n";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { readLocalApi } from "../../localApi";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { useConveneResourceStore } from "./conveneResourceStore";

export function ConveneResourceViewer({
  surface,
  hostRef,
}: {
  surface: ConveneResourceSurface;
  hostRef: ScopedThreadRef;
}) {
  const t = useTranslate();
  const { sourceThreadRef: threadRef, uri, id } = surface;
  const state = useConveneResourceStore((s) => s.sessions[id]?.state);
  const access = useConveneResourceStore((s) => s.sessions[id]?.access);
  const load = useConveneResourceStore((s) => s.load);
  const setScroll = useConveneResourceStore((s) => s.setScroll);
  const viewport = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The mounted tab requests its retained remote reading session, which outlives this view.
  useEffect(() => {
    const current = useConveneResourceStore.getState().sessions[id];
    if (current && !current.state.result && !current.state.pending) void load(id);
  }, [id, load]);
  const result =
    access?.status === "ready"
      ? state?.result
      : access && access.status !== "loading"
        ? { status: access.status, resource_uri: uri }
        : null;
  const ready = result?.status === "ready" ? result : null;
  const issue = ready && "issue" in ready ? ready : null;
  const document = ready && "document" in ready ? ready : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Restore only this resource viewport after its matching loaded window has rendered.
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !state?.result) return;
    const saved = useConveneResourceStore.getState().sessions[id]?.scrollTop ?? 0;
    const focused = issue?.focused_comment_number;
    const comment =
      focused == null ? null : element.querySelector<HTMLElement>(`#convene-comment-${focused}`);
    element.scrollTop =
      saved === 0 && comment
        ? comment.getBoundingClientRect().top -
          element.getBoundingClientRect().top +
          element.scrollTop
        : saved;
    setScroll(id, element.scrollTop);
  }, [id, state?.result, issue?.focused_comment_number, setScroll]);
  const open = (source: ScopedThreadRef, nextUri: string) =>
    useRightPanelStore.getState().openConveneResource(source, nextUri, hostRef);
  if (!state) return <p role="status">{t("convene.resource.loading")}</p>;
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
        <Button size="sm" variant="outline" disabled={state.pending} onClick={() => void load(id)}>
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
      <div
        ref={viewport}
        className="min-h-0 flex-1 overflow-auto p-4"
        onScroll={(event) => setScroll(id, event.currentTarget.scrollTop)}
      >
        <p className="mb-4 break-all text-xs text-muted-foreground">{uri}</p>
        {(state.pending || access?.status === "loading") && (
          <p role="status">{t("convene.resource.loading")}</p>
        )}
        {result && result.status !== "ready" && (
          <p role="alert">{t(`convene.resource.${result.status}`)}</p>
        )}
        {state.needsRefresh && <p role="alert">{t("convene.resource.documentChanged")}</p>}
        {document && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold">{document.document.title}</h2>
            <ChatMarkdown
              text={document.content}
              cwd={undefined}
              threadRef={threadRef}
              convenePanelRef={hostRef}
              conveneDocumentUri={document.resource_uri}
            />
            {!state.needsRefresh && document.slice.next_start_line !== null && (
              <Button
                variant="outline"
                size="sm"
                disabled={state.pending}
                onClick={() => void load(id, 1, document.slice.next_start_line ?? undefined)}
              >
                {t("convene.resource.moreContent")}
              </Button>
            )}
          </div>
        )}
        {issue && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">
                #{issue.issue.number} {issue.issue.title}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t(
                  issue.issue.state === "OPEN"
                    ? "convene.resource.issueStateOpen"
                    : "convene.resource.issueStateClosed",
                )}
              </p>
            </div>
            {issue.focused_comment_number !== null && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => open(threadRef, issue.issue.resource_uri)}
              >
                {t("convene.resource.viewIssue")}
              </Button>
            )}
            {issue.issue.body !== undefined && (
              <ChatMarkdown
                text={issue.issue.body}
                cwd={undefined}
                threadRef={threadRef}
                convenePanelRef={hostRef}
              />
            )}
            {issue.comments.map((comment) => (
              <article
                key={comment.number}
                id={`convene-comment-${comment.number}`}
                className={
                  comment.number === issue.focused_comment_number
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
                  <ChatMarkdown
                    text={comment.body ?? ""}
                    cwd={undefined}
                    threadRef={threadRef}
                    convenePanelRef={hostRef}
                  />
                )}
              </article>
            ))}
            {issue.focused_comment_number === null &&
              issue.page * issue.page_size < issue.total && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={state.pending}
                  onClick={() => void load(id, issue.page + 1)}
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
