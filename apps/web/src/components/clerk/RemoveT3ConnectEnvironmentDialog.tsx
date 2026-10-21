import { Trans } from "react-i18next";
import { useTranslate } from "../../i18n";
import { useState } from "react";

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
  onCancel,
  onConfirm,
}: {
  readonly environmentLabel: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const t = useTranslate();
  const accountPage = useT3ConnectAccountPage();
  const [shownLabel, setShownLabel] = useState(environmentLabel);
  if (environmentLabel !== null && environmentLabel !== shownLabel) setShownLabel(environmentLabel);
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
              {t("connections.removeDeviceQuestion", { label: shownLabel })}
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
