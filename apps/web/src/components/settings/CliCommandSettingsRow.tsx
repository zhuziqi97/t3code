import { useTranslate } from "../../i18n";
import { useState } from "react";

import {
  desktopCliCommandStateAtom,
  getDesktopCliCommandBridge,
  refreshDesktopCliCommandState,
} from "~/state/desktopCliCommand";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function CliCommandSettingsRow() {
  const t = useTranslate();
  const bridge = getDesktopCliCommandBridge();
  const query = useEnvironmentQuery(bridge ? desktopCliCommandStateAtom : null);
  const state = query.data;
  const [pending, setPending] = useState(false);

  const change = (action: "install" | "uninstall") => {
    if (!bridge || pending) return;
    setPending(true);
    void bridge[action]()
      .then(refreshDesktopCliCommandState)
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: action === "install" ? t("cli.installError") : t("cli.removeError"),
            description: error instanceof Error ? error.message : t("cli.error"),
          }),
        );
      })
      .finally(() => setPending(false));
  };

  if (!bridge || !state?.supported) return null;
  const installed = state.installedPath !== null;
  const description = state.shadowedBy
    ? t("convene.cli.shadowed", { path: state.shadowedBy })
    : !installed
      ? t("convene.cli.notInstalled")
      : state.onPath
        ? t("cli.installed", { path: state.installedPath })
        : t("convene.cli.notOnPath", { path: state.installedPath });

  return (
    <SettingsRow
      {...searchableSetting("cli-command", t)}
      description={description}
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={pending || query.isPending}
          onClick={() => change(installed ? "uninstall" : "install")}
        >
          {installed ? t("cli.remove") : t("cli.install")}
        </Button>
      }
    />
  );
}
