import { useAtomValue } from "@effect/atom-react";
import { CommandId, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useEffectEvent, useId, useState } from "react";
import { randomUUID } from "../lib/utils";
import { useTranslate } from "../i18n";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useQuietThreadShell } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { workspaceRecoveryEnvironment } from "../state/workspaceRecovery";
import { Button } from "./ui/button";

export function ThreadWorkspaceRecovery({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const t = useTranslate();
  const id = useId();
  const thread = useQuietThreadShell(scopeThreadRef(environmentId, threadId));
  const query = useEnvironmentQuery(
    workspaceRecoveryEnvironment.inspect({ environmentId, input: { threadId } }),
  );
  const permitted = useAtomValue(
    workspaceRecoveryEnvironment.recover.permissionAtom(environmentId),
  );
  const recover = useAtomCommand(workspaceRecoveryEnvironment.recover, { reportFailure: false });
  const [selection, setSelection] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recheck = useEffectEvent(() => query.refresh());
  const failedRunId = thread?.latestRun?.status === "failed" ? thread.latestRun.runId : null;
  // oxlint-disable-next-line t3code/react-effect-budget -- A failed provider run invalidates the server workspace-availability query.
  useEffect(() => {
    if (failedRunId !== null) recheck();
  }, [failedRunId]);
  if (!query.data || query.data.available) return null;
  const selected = query.data.choices.find((choice) => choice.path === selection);
  const reconnect = async () => {
    if (!selected || !permitted || busy) return;
    setBusy(true);
    setError(null);
    const result = await recover({
      environmentId,
      input: {
        commandId: CommandId.make(randomUUID()),
        threadId,
        worktreePath: selected.worktreePath,
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
    <section
      aria-labelledby={`${id}-title`}
      className="mx-3 mb-3 flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-3 text-sm"
    >
      <p id={`${id}-title`} className="font-medium">
        {t("workspaceRecovery.title", { defaultValue: "Workspace unavailable" })}
      </p>
      <p>
        {t("workspaceRecovery.description", {
          defaultValue:
            "Choose a checkout from this project to continue the same thread. Your conversation history is kept; the provider may start a new native session.",
        })}
      </p>
      <p className="break-all text-xs text-muted-foreground">{query.data.path}</p>
      <label htmlFor={id}>
        {t("workspaceRecovery.checkout", { defaultValue: "Project checkout or worktree" })}
      </label>
      <select
        id={id}
        value={selection}
        disabled={busy || !permitted}
        onChange={(event) => setSelection(event.target.value)}
        className="min-w-0 rounded-md border bg-background p-2"
      >
        <option value="">
          {t("workspaceRecovery.choose", { defaultValue: "Choose a workspace…" })}
        </option>
        {query.data.choices.map((choice) => (
          <option key={choice.path} value={choice.path}>
            {choice.displayName}
            {choice.branch ? ` (${choice.branch})` : ""}: {choice.path}
          </option>
        ))}
      </select>
      {error || query.error ? <p role="alert">{error ?? query.error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!selected || !permitted || busy}
          onClick={() => void reconnect()}
        >
          {t("workspaceRecovery.reconnect", { defaultValue: "Use selected workspace" })}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => query.refresh()}>
          {t("workspaceRecovery.refresh", { defaultValue: "Refresh workspaces" })}
        </Button>
      </div>
    </section>
  );
}
