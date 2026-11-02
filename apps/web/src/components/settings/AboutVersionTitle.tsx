import { useRef } from "react";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { showAnchoredCopySuccessToast } from "../ui/anchoredCopyToast";
import { InlineButton } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  APP_VERSION,
  UPSTREAM_VERSION,
  CONVENE_BUILD_ID,
  CONVENE_SOURCE_COMMIT,
} from "../../branding";
import { useTranslate } from "../../i18n";

export function AboutVersionTitle() {
  const t = useTranslate();
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const { copyToClipboard } = useCopyToClipboard<void>({
    target: "version",
    onCopy: () => showAnchoredCopySuccessToast(copyButtonRef),
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("about.copyVersionFailed"),
          description: error.message,
        }),
      );
    },
  });
  return (
    <span className="inline-flex flex-wrap items-baseline gap-2">
      <span>{t("about.version")}</span>
      <code className="text-2xs font-medium">
        <Tooltip>
          <TooltipTrigger
            render={
              <InlineButton
                ref={copyButtonRef}
                tone="muted"
                aria-label={t("about.copyVersionValue", { version: APP_VERSION })}
                onClick={() => copyToClipboard(APP_VERSION, undefined)}
              >
                {APP_VERSION}
              </InlineButton>
            }
          />
          <TooltipPopup>{t("about.copyVersion")}</TooltipPopup>
        </Tooltip>
      </code>
      <span className="text-2xs text-muted-foreground">
        {t("convene.about.upstream", {
          version: UPSTREAM_VERSION,
          defaultValue: "Upstream base {{version}}",
        })}
      </span>
      {CONVENE_BUILD_ID ? (
        <span className="text-2xs text-muted-foreground">
          {t("convene.about.build", {
            buildId: CONVENE_BUILD_ID,
            defaultValue: "Build {{buildId}}",
          })}
        </span>
      ) : null}
      {CONVENE_SOURCE_COMMIT ? (
        <span className="break-all text-2xs text-muted-foreground">
          {t("convene.about.sourceCommit", {
            commit: CONVENE_SOURCE_COMMIT,
            defaultValue: "Source {{commit}}",
          })}
        </span>
      ) : null}
    </span>
  );
}
