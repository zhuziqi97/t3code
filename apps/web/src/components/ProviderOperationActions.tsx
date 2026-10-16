import {
  AuthProvidersManageScope,
  type EnvironmentId,
  type ServerProvider,
} from "@t3tools/contracts";
import { useState } from "react";
import { useTranslate } from "../i18n";
import { serverEnvironment } from "../state/server";
import { useEnvironmentScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "./ui/button";

/** The action follows the server operation, so navigating does not lose cancellation. */
export function ProviderOperationActions({
  provider,
  environmentId,
}: {
  readonly provider: ServerProvider | undefined;
  readonly environmentId: EnvironmentId;
}) {
  const t = useTranslate();
  const canCancel = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const cancel = useAtomCommand(serverEnvironment.cancelProviderRefresh);
  const refresh = useAtomCommand(serverEnvironment.refreshProviders);
  const [cancelling, setCancelling] = useState(false);
  if (!provider?.enabled) return null;
  const pending = [provider.operation, ...(provider.metadataOperations ?? [])].filter(
    (operation) => operation?.state === "running",
  );
  if (pending.length === 0 && provider.status === "checking")
    return (
      <Button size="xs" variant="ghost-muted" disabled>
        {t("common.cancel")}
      </Button>
    );
  if (pending.length > 0) {
    return (
      <Button
        size="xs"
        variant="ghost-muted"
        disabled={!canCancel || cancelling}
        onClick={() => {
          setCancelling(true);
          void Promise.all(
            pending.map((operation) =>
              cancel({
                environmentId,
                input: { instanceId: provider.instanceId, operationId: operation!.id },
              }),
            ),
          ).finally(() => setCancelling(false));
        }}
      >
        {t("common.cancel")}
      </Button>
    );
  }
  if (
    provider.status === "cancelled" ||
    (provider.status === "error" &&
      provider.installed !== false &&
      provider.auth.status !== "unauthenticated")
  ) {
    return (
      <Button
        size="xs"
        variant="ghost-muted"
        onClick={() => {
          void refresh({ environmentId, input: { instanceId: provider.instanceId } });
        }}
      >
        {t("provider.reconnect")}
      </Button>
    );
  }
  return null;
}
