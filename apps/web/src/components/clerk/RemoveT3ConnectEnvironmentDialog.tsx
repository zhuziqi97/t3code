import { Trans } from "react-i18next";
import { Discovery } from "@t3tools/client-runtime/relay";
import type { EnvironmentId } from "@t3tools/contracts";
import { useTranslate } from "../../i18n";
import { useState } from "react";

import { useRelayEnvironmentDiscovery } from "../../state/environments";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button, InlineButton } from "../ui/button";
import { useT3ConnectAccountPage } from "./T3ConnectAccountPages";

export function RemoveT3ConnectEnvironmentDialog({
  environmentLabel,
  environmentId,
  onCancel,
  onConfirm,
}: {
  readonly environmentLabel: string | null;
  readonly environmentId: EnvironmentId | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const t = useTranslate();
  const accountPage = useT3ConnectAccountPage();
  const discovery = useRelayEnvironmentDiscovery();
  const registration = environmentId
    ? Discovery.relayEnvironmentRegistration(discovery, environmentId)
    : "unknown";
  const [shown, setShown] = useState({ label: environmentLabel, registration });
  if (
    environmentLabel !== null &&
    (environmentLabel !== shown.label || registration !== shown.registration)
  ) {
    setShown({ label: environmentLabel, registration });
  }
  const openAccountPage = accountPage.open;
  return (
    <>
      <AlertDialog
        open={environmentLabel !== null}
        onOpenChange={(open) => {
          if (!open) onCancel();
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("connections.removeDeviceQuestion", { label: shown.label })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("connections.forgetDevice")}</AlertDialogDescription>
            <AlertDialogDescription>
              <Trans
                t={t}
                i18nKey="connections.keepConnectRegistration"
                components={{
                  settings: openAccountPage ? (
                    <InlineButton
                      onClick={() => {
                        onCancel();
                        openAccountPage();
                      }}
                    />
                  ) : (
                    <span />
                  ),
                }}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("connections.cancel")}
            </AlertDialogClose>
            <Button variant="destructive" onClick={onConfirm}>
              {t("connections.removeDevice")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
      {accountPage.portals}
    </>
  );
}
