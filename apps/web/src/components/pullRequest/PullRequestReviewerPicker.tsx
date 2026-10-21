import { i18n, useTranslate } from "~/i18n";
import { useAtomCommand } from "~/state/use-atom-command";
import type {
  EnvironmentId,
  PullRequestRef,
  PullRequestReviewerCandidate,
} from "@t3tools/contracts";
import { CheckIcon, UserPlusIcon } from "lucide-react";
import { useState } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { toastManager } from "../ui/toast";
import { PullRequestCandidatePicker } from "./PullRequestCandidatePicker";
import { PullRequestActorLabel } from "./pullRequestPresentation";
import { readableFailure } from "./pullRequestDetail.logic";

function matches(candidate: PullRequestReviewerCandidate, query: string): boolean {
  if (query.length === 0) return true;
  const needle = query.toLowerCase();
  return (
    candidate.login.toLowerCase().includes(needle) ||
    (candidate.name ?? "").toLowerCase().includes(needle)
  );
}

export function PullRequestReviewerPicker({
  environmentId,
  reference,
  allowed,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  allowed: boolean;
}) {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const candidatesQuery = useEnvironmentQuery(
    open ? pullRequestEnvironment.reviewerCandidates({ environmentId, input: reference }) : null,
  );
  const requestReviewers = useAtomCommand(pullRequestEnvironment.requestReviewers, {
    reportFailure: false,
  });

  const candidates = (candidatesQuery.data?.candidates ?? []).filter((entry) =>
    matches(entry, query),
  );

  const toggle = async (candidate: PullRequestReviewerCandidate) => {
    if (pending !== null) return;
    setPending(candidate.id);
    const result = await requestReviewers({
      environmentId,
      input: {
        ...reference,
        reviewers: [{ id: candidate.id, kind: candidate.kind }],
        requested: !candidate.isRequested,
      },
    });
    setPending(null);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: candidate.isRequested
          ? i18n.t("pullRequest.flow.reviewers.removeFailed", { login: candidate.login })
          : i18n.t("pullRequest.flow.reviewers.addFailed", { login: candidate.login }),
        description: readableFailure(
          squashAtomCommandFailure(result),
          i18n.t("pullRequest.flow.reviewers.hint"),
        ),
      });
      return;
    }
    toastManager.add({
      type: "success",
      title: candidate.isRequested
        ? i18n.t("pullRequest.flow.reviewers.removed", { login: candidate.login })
        : i18n.t("pullRequest.flow.reviewers.added", { login: candidate.login }),
    });
  };

  return (
    <PullRequestCandidatePicker
      icon={<UserPlusIcon className="size-3.5" />}
      label={t("pullRequest.flow.reviewers.request")}
      allowed={allowed}
      disabledReason={t("pullRequest.flow.reviewers.permission")}
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      searchLabel={t("pullRequest.flow.reviewers.search")}
      isPending={candidatesQuery.isPending && candidatesQuery.data === null}
      error={candidatesQuery.data === null ? candidatesQuery.error : null}
      candidates={candidates}
      emptyLabel={t("pullRequest.flow.reviewers.none")}
      noMatchLabel={t("pullRequest.flow.reviewers.noMatch")}
      errorLabel={t("pullRequest.flow.reviewers.failed")}
      truncated={candidatesQuery.data?.truncated === true}
      truncatedLabel={t("pullRequest.flow.reviewers.truncated")}
      candidateKey={(candidate) => `${candidate.kind}:${candidate.id}`}
      disabled={pending !== null}
      onSelect={(candidate) => void toggle(candidate)}
    >
      {(candidate) => (
        <>
          <PullRequestActorLabel actor={candidate} className="flex-1" />
          {candidate.kind === "team" ? (
            <span className="shrink-0 text-muted-foreground">
              {t("pullRequest.flow.reviewers.team")}
            </span>
          ) : null}
          {candidate.isRequested ? (
            <CheckIcon
              aria-label={t("pullRequest.flow.reviewers.requested")}
              className="size-3.5 shrink-0"
            />
          ) : null}
        </>
      )}
    </PullRequestCandidatePicker>
  );
}
