import { getSourceControlPresentation } from "../sourceControlPresentation";
import type { TFunction } from "i18next";
import { i18n } from "../i18n";
import type {
  GitRunStackedActionResult,
  GitStackedAction,
  VcsStatusResult,
} from "@t3tools/contracts";
import { isTemporaryWorktreeBranch } from "@t3tools/shared/git";
import {
  DEFAULT_CHANGE_REQUEST_TERMINOLOGY,
  type ChangeRequestTerminology,
} from "../sourceControlPresentation";

export type GitActionIconName = "commit" | "push" | "pr";

export type GitDialogAction = "commit" | "push" | "create_pr";

export interface GitActionMenuItem {
  id: "commit" | "push" | "pr";
  label: string;
  disabled: boolean;
  icon: GitActionIconName;
  kind: "open_dialog";
  dialogAction?: GitDialogAction;
}

export interface GitQuickAction {
  label: string;
  disabled: boolean;
  kind: "run_action" | "run_pull" | "open_publish" | "show_hint";
  action?: GitStackedAction;
  hint?: string;
}

export interface DefaultBranchActionDialogCopy {
  title: string;
  description: string;
  continueLabel: string;
}

export interface GitActionProgressPresentation {
  readonly status: string;
  readonly output: string | null;
  readonly startedAtMs: number | null;
}

export interface GitActionResultToastTiming {
  readonly timeout: 0;
  readonly dismissAfterVisibleMs: number | null;
}

export type DefaultBranchConfirmableAction =
  | "push"
  | "create_pr"
  | "commit_push"
  | "commit_push_pr";

export const GIT_ACTION_SUCCESS_VISIBLE_MS = 10_000;

export function resolveGitActionResultToastTiming(
  type: "error" | "success",
): GitActionResultToastTiming {
  return {
    timeout: 0,
    dismissAfterVisibleMs: type === "success" ? GIT_ACTION_SUCCESS_VISIBLE_MS : null,
  };
}

function resolveChangeRequestTerminology(
  gitStatus: VcsStatusResult | null,
  t: TFunction = i18n.t,
): ChangeRequestTerminology {
  return gitStatus?.sourceControlProvider
    ? getSourceControlPresentation(gitStatus.sourceControlProvider, t).terminology
    : { ...DEFAULT_CHANGE_REQUEST_TERMINOLOGY, singular: t("git.pullRequest") };
}

export function resolveGitActionProgressPresentation(
  input: {
    readonly isRunning: boolean;
    readonly operation: string | null;
    readonly currentLabel: string | null;
    readonly lastOutputLine: string | null;
    readonly phaseStartedAtMs: number | null;
    readonly hookStartedAtMs: number | null;
  },
  t: TFunction = i18n.t,
): GitActionProgressPresentation | null {
  if (
    !input.isRunning ||
    (input.operation !== "run_change_request" && input.operation !== "pull")
  ) {
    return null;
  }

  const currentLabel = input.currentLabel?.trim();
  const output = input.lastOutputLine?.trim();
  const isPull = input.operation === "pull";
  return {
    status:
      currentLabel && currentLabel !== "Running source control action"
        ? currentLabel
        : isPull
          ? t("git.progress.pulling")
          : t("git.progress.starting"),
    output: !isPull && output ? output : null,
    startedAtMs: isPull
      ? input.phaseStartedAtMs
      : (input.hookStartedAtMs ?? input.phaseStartedAtMs),
  };
}

export function formatGitActionElapsed(startedAtMs: number | null, nowMs: number): string | null {
  if (startedAtMs === null) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1_000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function buildGitActionProgressStages(
  input: {
    action: GitStackedAction;
    hasCustomCommitMessage: boolean;
    hasWorkingTreeChanges: boolean;
    pushTarget?: string;
    featureBranch?: boolean;
    shouldPushBeforePr?: boolean;
    terminology?: ChangeRequestTerminology;
  },
  t: TFunction = i18n.t,
): string[] {
  const terminology = input.terminology ?? {
    ...DEFAULT_CHANGE_REQUEST_TERMINOLOGY,
    singular: t("git.pullRequest"),
  };
  const branchStages = input.featureBranch ? [t("git.progress.preparingRef")] : [];
  const pushStage = input.pushTarget
    ? t("git.progress.pushTarget", { target: input.pushTarget })
    : t("git.progress.pushing");
  const prStages = [
    t("git.progress.prepareRequest", { request: terminology.shortLabel }),
    t("git.progress.requestContent", { request: terminology.shortLabel }),
    t("git.progress.createRequest", { request: terminology.singular }),
  ];

  if (input.action === "push") {
    return [pushStage];
  }
  if (input.action === "create_pr") {
    return input.shouldPushBeforePr ? [pushStage, ...prStages] : prStages;
  }

  const shouldIncludeCommitStages = input.action === "commit" || input.hasWorkingTreeChanges;
  const commitStages = !shouldIncludeCommitStages
    ? []
    : input.hasCustomCommitMessage
      ? [t("git.progress.committing")]
      : [t("git.progress.commitMessage"), t("git.progress.committing")];
  if (input.action === "commit") {
    return [...branchStages, ...commitStages];
  }
  if (input.action === "commit_push") {
    return [...branchStages, ...commitStages, pushStage];
  }
  return [...branchStages, ...commitStages, pushStage, ...prStages];
}

export function buildMenuItems(
  gitStatus: VcsStatusResult | null,
  isBusy: boolean,
  hasPrimaryRemote = true,
  t: TFunction = i18n.t,
): GitActionMenuItem[] {
  if (!gitStatus) return [];
  const terminology = resolveChangeRequestTerminology(gitStatus, t);

  const hasBranch = gitStatus.refName !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isBehind = gitStatus.behindCount > 0;
  const hasDefaultBranchDelta = (gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) > 0;
  const canPushWithoutUpstream = hasPrimaryRemote && !gitStatus.hasUpstream;
  const canCommit = !isBusy && hasChanges;
  const canPush =
    !isBusy &&
    hasBranch &&
    !isBehind &&
    gitStatus.aheadCount > 0 &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);
  const canCreatePr =
    !isBusy &&
    hasBranch &&
    !hasChanges &&
    !hasOpenPr &&
    hasDefaultBranchDelta &&
    !isBehind &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);

  const commitItem: GitActionMenuItem = {
    id: "commit",
    label: t("git.commit"),
    disabled: !canCommit,
    icon: "commit",
    kind: "open_dialog",
    dialogAction: "commit",
  };

  if (!hasPrimaryRemote) {
    return [commitItem];
  }

  const pushItem: GitActionMenuItem = {
    id: "push",
    label: t("git.push"),
    disabled: !canPush,
    icon: "push",
    kind: "open_dialog",
    dialogAction: "push",
  };

  // An open change request is surfaced by the standalone attribution row, so
  // the menu offers no change-request entry at all while one is open.
  if (hasOpenPr) {
    return [commitItem, pushItem];
  }

  return [
    commitItem,
    pushItem,
    {
      id: "pr",
      label: t("git.createRequest", { request: terminology.shortLabel }),
      disabled: !canCreatePr,
      icon: "pr",
      kind: "open_dialog",
      dialogAction: "create_pr",
    },
  ];
}

export function resolveQuickAction(
  gitStatus: VcsStatusResult | null,
  isBusy: boolean,
  isDefaultRef = false,
  hasPrimaryRemote = true,
  t: TFunction = i18n.t,
): GitQuickAction {
  if (isBusy) {
    return { label: t("git.commit"), disabled: true, kind: "show_hint", hint: t("git.busy") };
  }

  if (!gitStatus) {
    return {
      label: t("git.commit"),
      disabled: true,
      kind: "show_hint",
      hint: t("git.statusUnavailable"),
    };
  }

  const hasBranch = gitStatus.refName !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const hasDefaultBranchDelta = (gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) > 0;
  const isBehind = gitStatus.behindCount > 0;
  const isDiverged = isAhead && isBehind;
  const terminology = resolveChangeRequestTerminology(gitStatus, t);

  if (!hasBranch) {
    return {
      label: t("git.commit"),
      disabled: true,
      kind: "show_hint",
      hint: t("git.refRequired", { request: terminology.singular }),
    };
  }

  if (hasChanges) {
    if (!gitStatus.hasUpstream && !hasPrimaryRemote) {
      return { label: t("git.commit"), disabled: false, kind: "run_action", action: "commit" };
    }
    if (hasOpenPr || isDefaultRef) {
      return {
        label: t("git.commitPush"),
        disabled: false,
        kind: "run_action",
        action: "commit_push",
      };
    }
    return {
      label: t("git.commitPushRequest", { request: terminology.shortLabel }),
      disabled: false,
      kind: "run_action",
      action: "commit_push_pr",
    };
  }

  if (!gitStatus.hasUpstream) {
    if (!hasPrimaryRemote) {
      return {
        label: t("git.publish.title"),
        disabled: false,
        kind: "open_publish",
      };
    }
    if (!isAhead) {
      if (hasOpenPr) {
        return {
          label: t("git.commit"),
          disabled: true,
          kind: "show_hint",
          hint: t("git.upToDateHint"),
        };
      }
      return {
        label: t("git.push"),
        disabled: true,
        kind: "show_hint",
        hint: t("git.noCommits"),
      };
    }
    if (hasOpenPr || isDefaultRef) {
      return {
        label: t("git.push"),
        disabled: false,
        kind: "run_action",
        action: isDefaultRef ? "commit_push" : "push",
      };
    }
    return {
      label: t("git.pushRequest", { request: terminology.shortLabel }),
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  if (isDiverged) {
    return {
      label: t("git.sync"),
      disabled: true,
      kind: "show_hint",
      hint: t("git.diverged"),
    };
  }

  if (isBehind) {
    return {
      label: t("git.pull"),
      disabled: false,
      kind: "run_pull",
    };
  }

  if (isAhead) {
    if (hasOpenPr || isDefaultRef) {
      return {
        label: t("git.push"),
        disabled: false,
        kind: "run_action",
        action: isDefaultRef ? "commit_push" : "push",
      };
    }
    return {
      label: t("git.pushRequest", { request: terminology.shortLabel }),
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  // An open change request is surfaced by the standalone attribution row in the
  // details panel, so the action button rests in its disabled up-to-date state.
  if (hasOpenPr && gitStatus.hasUpstream) {
    return {
      label: t("git.commit"),
      disabled: true,
      kind: "show_hint",
      hint: t("git.upToDateHint"),
    };
  }

  if (hasDefaultBranchDelta && !isDefaultRef) {
    return {
      label: t("git.createRequest", { request: terminology.shortLabel }),
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  return {
    label: t("git.commit"),
    disabled: true,
    kind: "show_hint",
    hint: t("git.upToDateHint"),
  };
}

export function requiresDefaultBranchConfirmation(
  action: GitStackedAction,
  isDefaultRef: boolean,
): boolean {
  if (!isDefaultRef) return false;
  return (
    action === "push" ||
    action === "create_pr" ||
    action === "commit_push" ||
    action === "commit_push_pr"
  );
}

export function resolveDefaultBranchActionDialogCopy(
  input: {
    action: DefaultBranchConfirmableAction;
    branchName: string;
    includesCommit: boolean;
    terminology?: ChangeRequestTerminology;
  },
  t: TFunction = i18n.t,
): DefaultBranchActionDialogCopy {
  const branchLabel = input.branchName;
  const suffix = t("git.defaultSuffix", { ref: branchLabel });
  const terminology = input.terminology ?? {
    ...DEFAULT_CHANGE_REQUEST_TERMINOLOGY,
    singular: t("git.pullRequest"),
  };

  if (input.action === "push" || input.action === "commit_push") {
    if (input.includesCommit) {
      return {
        title: t("git.defaultCommitPush"),
        description: t("git.defaultCommitPushHint", { suffix: suffix }),
        continueLabel: t("git.commitPushTo", { ref: branchLabel }),
      };
    }
    return {
      title: t("git.defaultPush"),
      description: t("git.defaultPushHint", { suffix: suffix }),
      continueLabel: t("git.pushTo", { ref: branchLabel }),
    };
  }

  if (input.includesCommit) {
    return {
      title: t("git.defaultCommitPushRequest", { request: terminology.shortLabel }),
      description: t("git.defaultCommitPushRequestHint", {
        request: terminology.singular,
        suffix: suffix,
      }),
      continueLabel: t("git.commitPushCreateRequest", { request: terminology.shortLabel }),
    };
  }
  return {
    title: t("git.defaultPushRequest", { request: terminology.shortLabel }),
    description: t("git.defaultPushRequestHint", { request: terminology.singular, suffix: suffix }),
    continueLabel: t("git.pushRequest", { request: terminology.shortLabel }),
  };
}

export function resolveThreadBranchUpdate(
  result: GitRunStackedActionResult,
): { branch: string } | null {
  if (result.branch.status !== "created" || !result.branch.name) {
    return null;
  }

  return {
    branch: result.branch.name,
  };
}

export function resolveThreadBranchMetadataPatch(
  branch: string | null,
  expectedBranch: string | null,
): {
  branch: string | null;
  expectedBranch: string | null;
} {
  return { branch, expectedBranch };
}

export function resolveLiveThreadBranchUpdate(input: {
  threadBranch: string | null;
  gitStatus: VcsStatusResult | null;
}): { branch: string | null } | null {
  if (!input.gitStatus) {
    return null;
  }

  if (input.gitStatus.refName === null && input.threadBranch !== null) {
    return null;
  }

  if (input.threadBranch === input.gitStatus.refName) {
    return null;
  }

  if (
    input.threadBranch !== null &&
    input.gitStatus.refName !== null &&
    !isTemporaryWorktreeBranch(input.threadBranch) &&
    isTemporaryWorktreeBranch(input.gitStatus.refName)
  ) {
    return null;
  }

  return {
    branch: input.gitStatus.refName,
  };
}

// Re-export from shared for backwards compatibility in this module's exports
export { resolveAutoFeatureBranchName } from "@t3tools/shared/git";
