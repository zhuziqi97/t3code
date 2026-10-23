import { useAtomValue } from "@effect/atom-react";
import {
  AuthFilesystemWriteScope,
  AuthTerminalOperateScope,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { conveneIdeLink } from "@t3tools/client-runtime/convene-ide-link";
import { Atom, AsyncResult } from "effect/reactivity";
import { Linking } from "react-native";
import { useTranslate } from "../../i18n";
import { conveneEnvironment } from "../../state/convene";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import * as Dialog from "../../components/ui/Dialog";

const DISCONNECTED = Atom.make(AsyncResult.initial<never, never>(false));

export function useConveneIdeAction(input: {
  environmentId: EnvironmentId | null;
  projectId: ProjectId | null;
  workspacePath: string | null;
  threadId?: ThreadId;
}) {
  const t = useTranslate();
  const canWrite = useEnvironmentScope(input.environmentId, AuthFilesystemWriteScope);
  const canOperateTerminal = useEnvironmentScope(input.environmentId, AuthTerminalOperateScope);
  const connection = useAtomValue(
    input.environmentId
      ? conveneEnvironment.status({ environmentId: input.environmentId, input: {} })
      : DISCONNECTED,
  );
  const status = AsyncResult.isSuccess(connection) ? connection.value : null;
  const project = useEnvironmentQuery(
    status?.phase === "online" &&
      canWrite &&
      canOperateTerminal &&
      input.environmentId &&
      input.projectId &&
      input.workspacePath
      ? conveneEnvironment.projectView({
          environmentId: input.environmentId,
          input: {
            projectId: input.projectId,
            workspacePath: input.workspacePath,
            ...(input.threadId ? { threadId: input.threadId } : {}),
          },
        })
      : null,
  );
  const href =
    project.data?.fresh &&
    project.data.configuration &&
    !project.isPending &&
    status &&
    input.projectId &&
    input.workspacePath
      ? conveneIdeLink({
          status,
          configuration: project.data.configuration,
          projectId: input.projectId,
          workspacePath: input.workspacePath,
        })
      : null;
  return href
    ? {
        title: t("convene.ide.open"),
        onPress: () => {
          void Linking.openURL(href).catch(() =>
            Dialog.alert(t("convene.ide.open"), t("convene.ide.unavailable")),
          );
        },
      }
    : undefined;
}
