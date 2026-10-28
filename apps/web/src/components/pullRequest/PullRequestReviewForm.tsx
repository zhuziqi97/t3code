import type { MessageKey } from "@t3tools/client-runtime/i18n";
import { i18n, useTranslate } from "~/i18n";
import { useAtomCommand } from "~/state/use-atom-command";

import type { EnvironmentId, PullRequestRef, PullRequestReviewVerdict } from "@t3tools/contracts";
import { CheckIcon, MessageSquareIcon, XCircleIcon } from "lucide-react";
import { useState, type ReactNode, type RefObject } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";

import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import {
  pullRequestReviewKey,
  usePendingReviewComments,
  usePullRequestReviewStore,
} from "./pullRequestReviewStore";

const VERDICTS: ReadonlyArray<{
  readonly value: PullRequestReviewVerdict;
  readonly labelKey: MessageKey;
  readonly sentKey: (term: string) => MessageKey;
  readonly icon: ReactNode;
}> = [
  {
    value: "comment",
    labelKey: "pullRequest.flow.comment",
    sentKey: () => "pullRequest.flow.review.sent",
    icon: <MessageSquareIcon className="size-3" />,
  },
  {
    value: "approve",
    labelKey: "pullRequest.flow.review.approve",
    sentKey: () => "pullRequest.flow.review.approved",
    icon: <CheckIcon className="size-3" />,
  },
  {
    value: "request-changes",
    labelKey: "pullRequest.flow.review.requestChanges",
    sentKey: () => "pullRequest.flow.review.changesRequested",
    icon: <XCircleIcon className="size-3" />,
  },
];

export function PullRequestReviewForm({
  environmentId,
  reference,
  term,
  verdicts,
  requestChangesSummaryRequired,
  textareaRef,
  pending,
  onPendingChange,
  onSubmitted,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  /** The host's word for a change request, as in "pull request". */
  term: string;
  verdicts: ReadonlyArray<PullRequestReviewVerdict>;
  requestChangesSummaryRequired: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
  onSubmitted: () => void;
}) {
  const t = useTranslate();
  const [requestedVerdict, setRequestedVerdict] = useState<PullRequestReviewVerdict>("comment");
  const comments = usePendingReviewComments(reference);
  const reviewKey = pullRequestReviewKey(reference);
  const body = usePullRequestReviewStore((store) => store.summaries[reviewKey] ?? "");
  const removeComments = usePullRequestReviewStore((store) => store.removeComments);
  const setSummary = usePullRequestReviewStore((store) => store.setSummary);
  const clearSummary = usePullRequestReviewStore((store) => store.clearSummary);
  const submitReview = useAtomCommand(pullRequestEnvironment.submitReview, {
    reportFailure: false,
  });

  const offered = VERDICTS.filter((verdict) => verdicts.includes(verdict.value));
  const selectedVerdict =
    offered.find((verdict) => verdict.value === requestedVerdict) ?? offered[0];

  const submit = async (verdict: (typeof VERDICTS)[number]) => {
    if (pending) return;
    const submittedBody = body;
    const submittedComments = comments;
    onPendingChange(true);
    const result = await submitReview({
      environmentId,
      input: {
        ...reference,
        verdict: verdict.value,
        body: submittedBody,
        comments: submittedComments,
      },
    });
    onPendingChange(false);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: i18n.t("pullRequest.flow.review.failed") });
      return;
    }
    // Preserve comments and summary edits made during submission.
    removeComments(
      reviewKey,
      submittedComments.map((comment) => comment.id),
    );
    clearSummary(reviewKey, submittedBody);
    toastManager.add({ type: "success", title: i18n.t(verdict.sentKey(term)) });
    onSubmitted();
  };

  // Forgejo requires a summary when requesting changes, even with inline comments.
  const canSubmit = (verdict: PullRequestReviewVerdict, summary: string) =>
    verdict === "request-changes" && requestChangesSummaryRequired
      ? summary.trim().length > 0
      : verdict === "approve" || summary.trim().length > 0 || comments.length > 0;
  const placeholder =
    selectedVerdict === undefined || canSubmit(selectedVerdict.value, "")
      ? "Summarize your review (optional)"
      : selectedVerdict.value === "request-changes" && requestChangesSummaryRequired
        ? "Summarize your review (required to request changes)"
        : "Summarize your review or add line comments";

  return (
    <>
      <Textarea
        ref={textareaRef}
        rows={3}
        value={body}
        placeholder={placeholder}
        aria-label={t("pullRequest.flow.review.summary")}
        onChange={(event) => setSummary(reviewKey, event.target.value)}
      />
      <div className="mt-2 flex justify-end gap-2">
        {offered.length > 1 ? (
          <Select
            value={selectedVerdict?.value ?? null}
            disabled={pending}
            onValueChange={(value) => {
              if (value !== null) setRequestedVerdict(value);
            }}
          >
            <SelectTrigger
              size="xs"
              className="mr-auto w-auto min-w-0"
              aria-label={t("pullRequest.flow.review.verdict")}
            >
              <span className="flex items-center gap-1.5">
                {selectedVerdict?.icon}
                {selectedVerdict ? t(selectedVerdict.labelKey) : null}
              </span>
            </SelectTrigger>
            <SelectPopup side="top" alignItemWithTrigger={false}>
              {offered.map((verdict) => (
                <SelectItem key={verdict.value} value={verdict.value}>
                  <span className="flex items-center gap-1.5">
                    {verdict.icon}
                    {t(verdict.labelKey)}
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
        <Button
          size="xs"
          disabled={
            pending || selectedVerdict === undefined || !canSubmit(selectedVerdict.value, body)
          }
          onClick={() => {
            if (selectedVerdict !== undefined) void submit(selectedVerdict);
          }}
        >
          {pending ? t("pullRequest.flow.review.submitting") : t("pullRequest.flow.review.submit")}
        </Button>
      </div>
    </>
  );
}
