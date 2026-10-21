import type { TFunction } from "i18next";
import { i18n } from "~/i18n";
import { readLocalApi } from "~/localApi";

let pendingConfirmations = 0;

export function isTerminalCloseConfirmPending(): boolean {
  return pendingConfirmations > 0;
}

export async function confirmTerminalClose(
  labels: readonly [string, ...string[]],
  translate: TFunction = i18n.t,
): Promise<boolean> {
  const localApi = readLocalApi();
  if (!localApi) return true;
  pendingConfirmations += 1;
  try {
    return await localApi.dialogs.confirm(
      labels.length === 1
        ? translate("terminal.closeConfirm.single", { label: labels[0] })
        : translate("terminal.closeConfirm.multiple", {
            count: labels.length,
            labels: labels.map((label) => `"${label}"`).join(", "),
          }),
      { variant: "destructive" },
    );
  } catch {
    return false;
  } finally {
    pendingConfirmations -= 1;
  }
}
