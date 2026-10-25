import { useAtomValue } from "@effect/atom-react";
import {
  AuthFilesystemWriteScope,
  AuthTerminalOperateScope,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
  type ConveneIdeRequest,
} from "@t3tools/contracts";
import { conveneIdeLink } from "@t3tools/client-runtime/convene-ide-link";
import { AsyncResult } from "effect/reactivity";
import { SquareArrowOutUpRightIcon } from "lucide-react";
import { useTranslate } from "../../i18n";
import { readLocalApi } from "../../localApi";
import { webBasePath } from "../../webBasePath";
import { conveneEnvironment } from "../../state/convene";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

export function ConveneIdeButton(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  workspacePath: string | null;
  threadId?: ThreadId;
  file?: Extract<ConveneIdeRequest, { workspaceKey: string }>["file"];
}) {
  const t = useTranslate();
  const canWrite = useEnvironmentScope(props.environmentId, AuthFilesystemWriteScope);
  const canOperateTerminal = useEnvironmentScope(props.environmentId, AuthTerminalOperateScope);
  const connection = useAtomValue(
    conveneEnvironment.status({ environmentId: props.environmentId, input: {} }),
  );
  const status = AsyncResult.isSuccess(connection) ? connection.value : null;
  const project = useEnvironmentQuery(
    status?.phase === "online" &&
      canWrite &&
      canOperateTerminal &&
      props.projectId &&
      props.workspacePath
      ? conveneEnvironment.projectView({
          environmentId: props.environmentId,
          input: {
            projectId: props.projectId,
            workspacePath: props.workspacePath,
            ...(props.threadId ? { threadId: props.threadId } : {}),
          },
        })
      : null,
  );
  const pageBase = webBasePath();
  const href =
    project.data?.fresh &&
    project.data.configuration &&
    !project.isPending &&
    status &&
    props.projectId &&
    props.workspacePath
      ? conveneIdeLink({
          status,
          configuration: project.data.configuration,
          projectId: props.projectId,
          workspacePath: props.workspacePath,
          ...(props.file ? { file: props.file } : {}),
          ...(pageBase.startsWith("/clients/") || pageBase.startsWith("/client-web/")
            ? { mountedOrigin: window.location.origin }
            : {}),
        })
      : null;
  if (!props.projectId || !props.workspacePath) return null;
  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={!href}
      title={
        !canWrite || !canOperateTerminal
          ? t("convene.ide.denied")
          : status?.phase !== "online"
            ? t("convene.ide.disconnected")
            : !href
              ? t("convene.ide.unavailable")
              : undefined
      }
      onClick={() => {
        if (!href) return;
        void readLocalApi()
          ?.shell.openExternal(href)
          .catch(() => toastManager.add({ type: "error", title: t("convene.ide.unavailable") }));
      }}
    >
      <SquareArrowOutUpRightIcon aria-hidden="true" />
      {t("convene.ide.open")}
    </Button>
  );
}
