import { useAtomValue } from "@effect/atom-react";
import {
  AuthFilesystemWriteScope,
  AuthTerminalOperateScope,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { conveneIdeLink, conveneIdeFileTarget } from "@t3tools/client-runtime/convene-ide-link";
import { Atom, AsyncResult } from "effect/reactivity";
import { useTranslate } from "./i18n";
import { readLocalApi } from "./localApi";
import { webBasePath } from "./webBasePath";
import { conveneEnvironment } from "./state/convene";
import { useThreadShell } from "./state/entities";
import { useEnvironmentQuery } from "./state/query";
import { readEnvironmentScope, useEnvironmentScope } from "./state/session";

export interface EditorWorkspace {
  projectId?: ProjectId | null | undefined;
  threadId?: ThreadId | undefined;
  workspacePath: string | null;
}

const DISCONNECTED = Atom.make(AsyncResult.initial<never, never>(false));

export function useBrowserEditorAction(
  environmentId: EnvironmentId | null,
  workspace?: EditorWorkspace,
) {
  const t = useTranslate();
  const thread = useThreadShell(
    environmentId && workspace?.threadId ? { environmentId, threadId: workspace.threadId } : null,
  );
  const projectId = workspace?.projectId ?? thread?.projectId ?? null;
  const workspacePath = workspace?.workspacePath;
  const canWrite = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const connection = useAtomValue(
    environmentId && workspace
      ? conveneEnvironment.status({ environmentId, input: {} })
      : DISCONNECTED,
  );
  const status = AsyncResult.isSuccess(connection) ? connection.value : null;
  const project = useEnvironmentQuery(
    status?.phase === "online" &&
      canWrite &&
      canOperateTerminal &&
      environmentId &&
      projectId &&
      workspacePath
      ? conveneEnvironment.projectView({
          environmentId,
          input: {
            projectId,
            workspacePath,
            ...(workspace?.threadId ? { threadId: workspace.threadId } : {}),
          },
        })
      : null,
  );
  const pageBase = webBasePath();
  const linkInput =
    project.data?.fresh &&
    project.data.configuration &&
    !project.isPending &&
    status &&
    projectId &&
    workspacePath
      ? {
          status,
          configuration: project.data.configuration,
          projectId,
          workspacePath,
          ...(pageBase.startsWith("/clients/") || pageBase.startsWith("/client-web/")
            ? { mountedOrigin: window.location.origin }
            : {}),
        }
      : null;
  const href = canWrite && canOperateTerminal && linkInput ? conveneIdeLink(linkInput) : null;
  const unavailableReason =
    !projectId || !workspacePath
      ? t("chat.editor.workspaceRequired")
      : !canWrite || !canOperateTerminal
        ? t("convene.ide.denied")
        : status?.phase !== "online"
          ? t("convene.ide.disconnected")
          : !href
            ? t("convene.ide.unavailable")
            : null;
  return {
    unavailableReason,
    open: async (targetPath: string, isFile: boolean) => {
      if (
        !environmentId ||
        !readEnvironmentScope(environmentId, AuthFilesystemWriteScope) ||
        !readEnvironmentScope(environmentId, AuthTerminalOperateScope)
      )
        throw new Error(t("convene.ide.denied"));
      if (!href || !linkInput) throw new Error(unavailableReason ?? t("convene.ide.unavailable"));
      const target = conveneIdeFileTarget(linkInput.workspacePath, targetPath, isFile);
      if (target === null) throw new Error(t("chat.editor.outsideWorkspace"));
      const url = conveneIdeLink({ ...linkInput, ...target });
      const api = readLocalApi();
      if (!url || !api) throw new Error(t("convene.ide.unavailable"));
      await api.shell.openExternal(url);
    },
  };
}
