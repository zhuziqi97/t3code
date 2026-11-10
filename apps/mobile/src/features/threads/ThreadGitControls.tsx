import { Toolbar } from "../../components/ui/Toolbar";
import { useTranslate } from "../../i18n";
import * as Dialog from "../../components/ui/Dialog";
import { useOpenPullRequest } from "../../native/useOpenPullRequest";
import type { AppBarMenu } from "../../components/ui/AppBar.types";
import {
  AuthSourceControlWriteScope,
  EnvironmentId,
  type GitRunStackedActionResult,
  type ProjectScript,
  ThreadId,
  type VcsStatusResult,
} from "@t3tools/contracts";
import {
  type GitActionRequestInput,
  requiresDefaultBranchConfirmation,
  resolveQuickAction,
} from "@t3tools/client-runtime/state/vcs";
import { useNavigation } from "@react-navigation/native";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";

import { useEnvironmentScope } from "../../state/session";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import {
  basename,
  getTerminalStatusLabel,
  projectScriptMenuIcon,
  type TerminalMenuSession,
} from "../terminal/terminalMenu";
import { projectScriptMenuLabel } from "@t3tools/shared/projectScripts";

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const headLength = Math.ceil((maxLength - 1) / 2);
  const tailLength = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, headLength)}…${value.slice(value.length - tailLength)}`;
}

function compactMenuBranchLabel(branch: string): string {
  return truncateMiddle(branch, 24);
}

function compactMenuStatus(gitStatus: VcsStatusResult | null): string {
  if (!gitStatus) {
    return "Checking status";
  }
  if (!gitStatus.isRepo) {
    return "Not a repo";
  }

  const parts: string[] = [];
  if (gitStatus.hasWorkingTreeChanges) {
    parts.push(`${gitStatus.workingTree.files.length} changed`);
  } else if (gitStatus.aheadCount === 0 && gitStatus.behindCount === 0) {
    parts.push("Clean");
  }
  if (gitStatus.aheadCount > 0) {
    parts.push(`${gitStatus.aheadCount} ahead`);
  }
  if (gitStatus.behindCount > 0) {
    parts.push(`${gitStatus.behindCount} behind`);
  }
  if (gitStatus.pr?.state === "open") {
    const { shortLabel } = sourceControlClients.get(
      gitStatus.sourceControlProvider?.kind,
    ).changeRequest;
    parts.push(`${shortLabel} #${gitStatus.pr.number}`);
  }

  return parts.join(" · ");
}

type QuickActionIcon =
  | "arrow.down.circle"
  | "arrow.up.right.circle"
  | "checkmark.circle"
  | "arrow.up.circle";

export type ThreadGitMenuProps = {
  readonly environmentId: EnvironmentId | string;
  readonly threadId: ThreadId | string;
  readonly currentBranch: string | null;
  readonly hasThread?: boolean;
  readonly gitStatus: VcsStatusResult | null;
  readonly gitOperationLabel: string | null;
  readonly onOpenFilesInspector?: () => void;
  readonly onOpenGitInspector?: () => void;
  readonly onMergeBack?: () => void;
  readonly webIde?: { readonly title: string; readonly onPress: () => void };
  readonly onPull: () => Promise<void>;
  readonly onRunAction: (input: GitActionRequestInput) => Promise<GitRunStackedActionResult | null>;
};

export type ThreadGitControlsProps = ThreadGitMenuProps & {
  readonly canOpenTerminal: boolean;
  readonly canOperateTerminal: boolean;
  readonly canOpenFiles: boolean;
  readonly projectScripts: ReadonlyArray<ProjectScript>;
  readonly terminalSessions: ReadonlyArray<TerminalMenuSession>;
  readonly onOpenTerminal: (terminalId?: string | null) => void;
  readonly onOpenNewTerminal: () => void;
  readonly onRunProjectScript: (script: ProjectScript) => Promise<void>;
};

function useThreadGitControlModel(props: ThreadGitMenuProps) {
  const navigation = useNavigation();
  const openPullRequest = useOpenPullRequest();
  const environmentId = props.environmentId;
  const canWriteSourceControl = useEnvironmentScope(
    environmentId ? EnvironmentId.make(String(environmentId)) : null,
    AuthSourceControlWriteScope,
  );
  const threadId = props.threadId;
  const { gitStatus, gitOperationLabel, onPull, onRunAction } = props;

  const currentBranchLabel = gitStatus?.refName ?? props.currentBranch ?? "Detached HEAD";
  const busy = gitOperationLabel !== null;
  const isRepo = gitStatus?.isRepo ?? true;
  const hasPrimaryRemote = gitStatus?.hasPrimaryRemote ?? false;
  const isDefaultRef = gitStatus?.isDefaultRef ?? false;

  const quickAction = (() => {
    if (!isRepo) {
      return {
        label: "Git unavailable",
        disabled: true,
        kind: "show_hint" as const,
        hint: "This workspace is not a git repository.",
      };
    }
    const action = resolveQuickAction(gitStatus, busy, isDefaultRef, hasPrimaryRemote);
    return !canWriteSourceControl && (action.kind === "run_pull" || action.kind === "run_action")
      ? {
          ...action,
          disabled: true,
          hint: "This connection cannot change source control.",
        }
      : action;
  })();

  const quickActionHint = quickAction.disabled
    ? (quickAction.hint ?? "This action is unavailable.")
    : null;

  const quickActionIcon: QuickActionIcon = (() => {
    if (quickAction.kind === "run_pull") return "arrow.down.circle";
    if (quickAction.kind === "open_pr") return "arrow.up.right.circle";
    if (quickAction.kind === "run_action") {
      if (quickAction.action === "commit") return "checkmark.circle";
      if (quickAction.action === "push" || quickAction.action === "commit_push")
        return "arrow.up.circle";
    }
    return "arrow.up.right.circle";
  })();

  const openExistingPr = async () => {
    const { shortLabel, singular } = sourceControlClients.get(
      gitStatus?.sourceControlProvider?.kind,
    ).changeRequest;
    const prUrl = gitStatus?.pr?.state === "open" ? gitStatus.pr.url : null;
    if (!prUrl) {
      Dialog.alert(`No open ${shortLabel}`, `This branch does not have an open ${singular}.`);
      return;
    }
    if (!(await openPullRequest(prUrl))) {
      Dialog.alert(`Unable to open ${shortLabel}`, `The ${singular} could not be opened.`);
    }
  };

  const runActionWithPrompt = async (input: GitActionRequestInput) => {
    if (!canWriteSourceControl) return;
    const confirmableAction =
      input.action === "push" ||
      input.action === "create_pr" ||
      input.action === "commit_push" ||
      input.action === "commit_push_pr"
        ? input.action
        : null;
    const branchName = gitStatus?.refName;
    if (
      branchName &&
      confirmableAction &&
      !input.featureBranch &&
      requiresDefaultBranchConfirmation(input.action, isDefaultRef)
    ) {
      if (props.hasThread === false) {
        Dialog.alert(
          "Choose a feature branch",
          "Switch branches before publishing changes from this draft.",
        );
        return;
      }
      navigation.navigate("GitConfirm", {
        environmentId: String(environmentId),
        threadId: String(threadId),
        confirmAction: confirmableAction,
        branchName,
        includesCommit: String(input.action === "commit_push" || input.action === "commit_push_pr"),
      });
      return;
    }

    await onRunAction(input);
  };

  const runQuickAction = async () => {
    if (quickAction.disabled) return;
    if (quickAction.kind === "open_pr") {
      await openExistingPr();
      return;
    }
    if (quickAction.kind === "run_pull") {
      await onPull();
      return;
    }
    if (quickAction.kind === "run_action" && quickAction.action) {
      await runActionWithPrompt({ action: quickAction.action });
    }
  };

  const openReview = () => {
    navigation.navigate("ThreadReview", {
      environmentId: EnvironmentId.make(String(environmentId)),
      threadId: ThreadId.make(String(threadId)),
    });
  };

  const openGitInspector = () => {
    if (props.onOpenGitInspector) {
      props.onOpenGitInspector();
      return;
    }
    navigation.navigate("GitOverview", {
      environmentId: String(environmentId),
      threadId: String(threadId),
    });
  };

  return {
    currentBranchLabel,
    isRepo,
    openGitInspector,
    openReview,
    quickAction,
    quickActionHint,
    quickActionIcon,
    runQuickAction,
  };
}

export function threadTerminalMenu(props: ThreadGitControlsProps): AppBarMenu | null {
  if (!props.canOpenTerminal) return null;
  return {
    title: "Terminal",
    icon: "terminal",
    separateBackground: false,
    items: [
      ...(props.projectScripts.length > 0
        ? props.projectScripts.map((script) => ({
            id: `script-${script.id}`,
            title: projectScriptMenuLabel(script),
            icon: projectScriptMenuIcon(script.icon),
            subtitle: script.command,
            disabled: !props.canOperateTerminal,
            onPress: () => void props.onRunProjectScript(script),
          }))
        : [
            {
              id: "script-none",
              title: "No project scripts",
              icon: "play",
              subtitle: "This project has no saved scripts yet",
              disabled: true,
              onPress: () => {},
            },
          ]),
      ...props.terminalSessions.map((session) => ({
        id: `terminal-${session.terminalId}`,
        title: session.displayLabel,
        icon: "terminal",
        subtitle: [
          getTerminalStatusLabel({
            status: session.status,
            hasRunningSubprocess: session.hasRunningSubprocess,
          }),
          basename(session.cwd),
        ]
          .filter(Boolean)
          .join(" · "),
        onPress: () => props.onOpenTerminal(session.terminalId),
      })),
      {
        id: "terminal-new",
        title: "Open new terminal",
        icon: "plus",
        subtitle: "Start another shell for this thread",
        disabled: !props.canOperateTerminal,
        onPress: props.onOpenNewTerminal,
      },
    ],
  };
}

export function useThreadGitRightHeaderItems(props: ThreadGitControlsProps): HeaderItems {
  const actionItems = useThreadGitHeaderActionItems(props);
  return [actionItems.git, actionItems.files, actionItems.terminal] as HeaderItems;
}

export function useThreadGitCenterHeaderItems(props: ThreadGitControlsProps): HeaderItems {
  const actionItems = useThreadGitHeaderActionItems(props);
  return [actionItems.files, actionItems.git, actionItems.terminal] as HeaderItems;
}

export function ThreadGitControls(props: ThreadGitControlsProps) {
  const t = useTranslate();
  const model = useThreadGitControlModel(props);
  const showActionControls = props.showActionControls ?? true;

  if (!showActionControls) {
    return null;
  }

  return (
    <Toolbar placement="right">
      {showActionControls && props.auxiliaryPaneControl ? (
        <Toolbar.Button
          accessibilityLabel={props.auxiliaryPaneControl.accessibilityLabel}
          icon="sidebar.right"
          onPress={props.auxiliaryPaneControl.onPress}
          separateBackground
        />
      ) : null}
      {showActionControls ? (
        <Toolbar.Menu
          accessibilityLabel="Open terminal"
          icon="terminal"
          disabled={!props.canOpenTerminal}
          separateBackground
        >
          {props.projectScripts.length > 0 ? (
            props.projectScripts.map((script) => (
              <Toolbar.MenuAction
                key={script.id}
                icon={projectScriptMenuIcon(script.icon)}
                disabled={!props.canOperateTerminal}
                onPress={() => void props.onRunProjectScript(script)}
                subtitle={script.command}
              >
                <Toolbar.Label>{projectScriptMenuLabel(script)}</Toolbar.Label>
              </Toolbar.MenuAction>
            ))
          ) : (
            <Toolbar.MenuAction
              icon="play"
              disabled
              onPress={() => {}}
              subtitle={t("project.scripts.noneDescription")}
            >
              <Toolbar.Label>{t("project.scripts.none")}</Toolbar.Label>
            </Toolbar.MenuAction>
          )}
          {props.terminalSessions.map((session) => (
            <Toolbar.MenuAction
              key={session.terminalId}
              icon="terminal"
              onPress={() => props.onOpenTerminal(session.terminalId)}
              subtitle={[
                getTerminalStatusLabel({
                  status: session.status,
                  hasRunningSubprocess: session.hasRunningSubprocess,
                }),
                basename(session.cwd),
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              <Toolbar.Label>{session.displayLabel}</Toolbar.Label>
            </Toolbar.MenuAction>
          ))}
          <Toolbar.MenuAction
            icon="plus"
            disabled={!props.canOperateTerminal}
            onPress={props.onOpenNewTerminal}
            subtitle="Start another shell for this thread"
          >
            <Toolbar.Label>Open new terminal</Toolbar.Label>
          </Toolbar.MenuAction>
        </Toolbar.Menu>
      ) : null}
      {showActionControls && props.showDirectFileControl ? (
        <Toolbar.Button
          accessibilityLabel="Open files"
          disabled={!props.canOpenFiles}
          icon="folder"
          onPress={model.openFiles}
          separateBackground
        />
      ) : null}
      {showActionControls ? createNativeHeaderMenu(threadGitMenuDefinition(props, model)) : null}
    </Toolbar>
  );
}

export function ThreadGitMenu(props: ThreadGitMenuProps) {
  const menu = useThreadGitMenuDefinition(props);
  return menu ? createNativeHeaderMenu(menu) : null;
}

/** Returns menu data because native toolbars serialize direct items rather than rendering component children. */
export function useThreadGitMenuDefinition(props: ThreadGitMenuProps): AppBarMenu | null {
  const model = useThreadGitControlModel(props);
  return {
    title: "Git controls",
    icon: "point.topleft.down.curvedto.point.bottomright.up",
    separateBackground: false,
    items: [
      ...(props.webIde
        ? [
            {
              id: "web-ide",
              title: props.webIde.title,
              icon: "terminal" as const,
              onPress: props.webIde.onPress,
            },
          ]
        : []),
      {
        id: "git-status",
        title: compactMenuBranchLabel(model.currentBranchLabel),
        icon: "point.topleft.down.curvedto.point.bottomright.up",
        disabled: true,
        subtitle: compactMenuStatus(props.gitStatus),
        onPress: () => {},
      },
      {
        id: "git-quick-action",
        title: model.quickAction.label,
        icon: model.quickActionIcon,
        disabled: model.quickAction.disabled,
        subtitle: model.quickActionHint ?? undefined,
        onPress: () => {
          void model.runQuickAction();
        },
      },
      {
        id: "git-review",
        title: "Review changes",
        icon: "text.bubble",
        disabled: !model.isRepo || props.hasThread === false,
        subtitle:
          props.hasThread === false
            ? "Available after the first message"
            : "Turn diffs and worktree changes",
        onPress: model.openReview,
      },
      ...(props.onMergeBack
        ? [
            {
              id: "git-merge-back",
              title: "Merge back to source",
              icon: PullRequestGlyph.merged,
              subtitle: "Bring this thread's latest turn into its source",
              onPress: props.onMergeBack,
            },
          ]
        : []),
      {
        id: "git-more",
        title: "More",
        icon: "ellipsis",
        disabled: props.hasThread === false,
        subtitle:
          props.hasThread === false
            ? "Available after the first message"
            : "Commit, files, branches",
        onPress: model.openGitInspector,
      },
    ],
  };
}
