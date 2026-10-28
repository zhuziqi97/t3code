import type { TFunction } from "i18next";
import { i18n, useTranslate } from "../i18n";
import { type SlowRpcAckRequest, subscribeSlowRpcAckRequests } from "../rpc/requestLatencyState";
import { toastManager } from "./ui/toast";

function describeSlowRequests(requests: ReadonlyArray<SlowRpcAckRequest>, t: TFunction): string {
  const count = requests.length;
  const thresholdSeconds = Math.round(
    Math.min(...requests.map((request) => request.thresholdMs)) / 1000,
  );

  return t("toast.slowRequests.description", { count, seconds: thresholdSeconds });
}

function SlowRequestDetails({ requests }: { requests: ReadonlyArray<SlowRpcAckRequest> }) {
  const t = useTranslate();
  return (
    <ul className="space-y-2.5 text-xs text-muted-foreground">
      {requests.map((request) => (
        <li
          className="min-w-0 border-border/50 border-b pb-2 last:border-b-0 last:pb-0"
          key={request.requestId}
        >
          <div className="wrap-break-word font-medium text-foreground">{request.tag}</div>
          <div className="mt-0.5 text-3xs opacity-75">
            {t("toast.slowRequests.started", {
              time: new Date(request.startedAt).toLocaleTimeString(),
            })}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** One warning toast that tracks the set of slow requests while any are outstanding. */
export function startSlowRpcRequestToasts(): () => void {
  const t = i18n.t;
  let toastId: ReturnType<typeof toastManager.add> | null = null;

  let currentRequests: ReadonlyArray<SlowRpcAckRequest> = [];
  const render = (slowRequests: ReadonlyArray<SlowRpcAckRequest>) => {
    currentRequests = slowRequests;
    if (slowRequests.length === 0) {
      if (toastId !== null) {
        toastManager.close(toastId);
        toastId = null;
      }
      return;
    }

    const nextToast = {
      data: {
        expandableContent: <SlowRequestDetails requests={slowRequests} />,
        expandableDescriptionTrigger: true,
        expandableLabels: {
          collapse: t("toast.slowRequests.hide"),
          expand: t("toast.slowRequests.show"),
        },
      },
      description: describeSlowRequests(slowRequests, t),
      timeout: 0,
      title: t("toast.slowRequests.title"),
      type: "warning" as const,
    };

    if (toastId === null) {
      toastId = toastManager.add(nextToast);
    } else {
      toastManager.update(toastId, nextToast);
    }
  };
  const unsubscribe = subscribeSlowRpcAckRequests(render);
  const translate = () => render(currentRequests);
  i18n.on("languageChanged", translate);
  return () => {
    unsubscribe();
    i18n.off("languageChanged", translate);
    if (toastId !== null) toastManager.close(toastId);
  };
}
