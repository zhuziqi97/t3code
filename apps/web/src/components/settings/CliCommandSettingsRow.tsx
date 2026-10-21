import { useTranslate } from "../../i18n";
import type { DesktopCliCommandState } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function CliCommandSettingsRow() {
  const t = useTranslate();
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge?.cliCommand;
  const [state, setState] = useState<DesktopCliCommandState | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void bridge
      .getState()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const change = (action: "install" | "uninstall") => {
    if (!bridge || pending) return;
    setPending(true);
    void bridge[action]()
      .then(setState)
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
          disabled={pending}
          onClick={() => change(installed ? "uninstall" : "install")}
        >
          {installed ? t("cli.remove") : t("cli.install")}
        </Button>
      }
    />
  );
}
