import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useTranslate } from "../i18n";
import { formatFilePathForClipboard } from "@t3tools/client-runtime/media-actions";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useRef } from "react";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { ANCHORED_COPY_TOAST_TIMEOUT_MS, showAnchoredCopyErrorToast } from "./ui/anchoredCopyToast";
import { Button } from "./ui/button";

export function DiffFilePathCopyButton({
  filePath,
  workspaceRoot,
}: {
  filePath: string;
  workspaceRoot: string | undefined;
}) {
  const t = useTranslate();
  const ref = useRef<HTMLButtonElement>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    onError: (error) => showAnchoredCopyErrorToast(ref, error),
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={ref}
            size="icon-micro"
            variant="ghost-muted"
            aria-label={t("diff.copyFilePath")}
            onClick={() =>
              copyToClipboard(formatFilePathForClipboard(filePath, workspaceRoot), undefined)
            }
          />
        }
      >
        {isCopied ? <CheckIcon className="size-3 text-success" /> : <CopyIcon className="size-3" />}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{isCopied ? t("common.copied") : t("diff.copyPath")}</p>
      </TooltipPopup>
    </Tooltip>
  );
}
