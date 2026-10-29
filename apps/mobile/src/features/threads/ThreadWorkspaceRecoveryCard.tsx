import { useAtomValue } from "@effect/atom-react";
import { CommandId, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useEffectEvent, useState } from "react";
import { ScrollView, View } from "react-native";
import { useTranslate } from "../../i18n";
import { uuidv4 } from "../../lib/uuid";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useThreadSelection } from "../../state/use-thread-selection";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { workspaceRecoveryEnvironment } from "../../state/workspaceRecovery";

export function ThreadWorkspaceRecoveryCard({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const t = useTranslate();
  const { selectedThread } = useThreadSelection();
  const query = useEnvironmentQuery(
    workspaceRecoveryEnvironment.inspect({ environmentId, input: { threadId } }),
  );
  const permitted = useAtomValue(
    workspaceRecoveryEnvironment.recover.permissionAtom(environmentId),
  );
  const recover = useAtomCommand(workspaceRecoveryEnvironment.recover, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recheck = useEffectEvent(() => query.refresh());
  const failedRunId =
    selectedThread?.latestRun?.status === "failed" ? selectedThread.latestRun.runId : null;
  // oxlint-disable-next-line t3code/react-effect-budget -- A failed provider run invalidates the server workspace-availability query.
  useEffect(() => {
    if (failedRunId !== null) recheck();
  }, [failedRunId]);
  if (!query.data || query.data.available) return null;
  const reconnect = async (worktreePath: string | null) => {
    if (!permitted || busy) return;
    setBusy(true);
    setError(null);
    const result = await recover({
      environmentId,
      input: {
        commandId: CommandId.make(uuidv4()),
        threadId,
        worktreePath,
      },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(
        cause instanceof Error
          ? cause.message
          : t("workspaceRecovery.failed", {
              defaultValue: "Could not reconnect this workspace. Try again.",
            }),
      );
    }
    query.refresh();
  };
  return (
    <View className="gap-2 border-b border-border bg-card p-3">
      <Text className="font-t3-bold">
        {t("workspaceRecovery.title", { defaultValue: "Workspace unavailable" })}
      </Text>
      <Text>
        {t("workspaceRecovery.description", {
          defaultValue:
            "Choose a checkout from this project to continue the same thread. Your conversation history is kept; the provider may start a new native session.",
        })}
      </Text>
      <ScrollView style={{ maxHeight: 180 }}>
        {query.data.choices.map((choice) => (
          <View key={choice.path} className="gap-1 py-1">
            <Text>{choice.path}</Text>
            <Button
              label={t("workspaceRecovery.use", {
                defaultValue: "Use {{workspace}}",
                workspace: choice.branch ?? choice.displayName,
              })}
              disabled={!permitted || busy}
              onPress={() => void reconnect(choice.worktreePath)}
            />
          </View>
        ))}
      </ScrollView>
      {error || query.error ? <Text accessibilityRole="alert">{error ?? query.error}</Text> : null}
      <Button
        label={t("workspaceRecovery.refresh", { defaultValue: "Refresh workspaces" })}
        disabled={busy}
        onPress={() => query.refresh()}
      />
    </View>
  );
}
