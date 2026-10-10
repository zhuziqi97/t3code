import { useState } from "react";
import { Trans } from "react-i18next";
import { useTranslate } from "~/i18n";

import { Button } from "~/components/ui/button";

import { describePreviewError } from "./errorCodeMessages";

interface Props {
  url: string;
  /** Chromium net error code, e.g. -105. */
  code: number;
  /** Stringified Chromium error, e.g. "ERR_NAME_NOT_RESOLVED". */
  description: string;
  onReload: () => void;
  /** Reopens the page in a browser that may reach it, such as the environment's. */
  move?: { readonly label: string; readonly onMove: () => void };
}

/**
 * A server tab's address was a file its browser cannot show (a PDF), so the
 * browser downloaded it. Offers the address in the user's own browser, or the
 * file the server already saved.
 */
export function PreviewFileNotShown({
  url,
  fileName,
  downloadUrl,
  onOpen,
}: {
  url: string;
  fileName: string;
  downloadUrl: string | null;
  onOpen: () => void;
}) {
  const t = useTranslate();
  const host = safeHost(url) ?? url;
  return (
    <div className="scrollbar-gutter-both relative flex h-full min-h-0 w-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-8 py-12 sm:py-16">
        <ErrorIcon className="mb-6 size-12 text-muted-foreground/70" />
        <h1 className="mb-3 text-2xl font-semibold leading-tight text-foreground">
          {t("browser.fileNotShown")}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <Trans
            i18nKey="browser.fileDownloaded"
            values={{ name: fileName, host }}
            components={{ file: <span className="font-semibold text-foreground" /> }}
          />
        </p>
        <div className="mt-auto flex items-center gap-2 pt-8">
          <div className="flex-1" />
          <Button type="button" variant="outline" size="sm" onClick={onOpen}>
            {t("browser.openBrowser")}
          </Button>
          {downloadUrl ? (
            <Button type="button" size="sm" render={<a href={downloadUrl} download={fileName} />}>
              {t("browser.download")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Theme-aware tailwind port of Chromium's "This site can't be reached" page. */
export function PreviewUnreachable({ url, code, description, onReload, move }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const t = useTranslate();
  const host = safeHost(url) ?? url;
  const friendly = describePreviewError(description, t);
  const errorLabel = description.length > 0 ? description : `ERR_${Math.abs(code) || "FAILED"}`;

  return (
    <div className="scrollbar-gutter-both relative flex h-full min-h-0 w-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-8 py-12 sm:py-16">
        <ErrorIcon className="mb-6 size-12 text-muted-foreground/70" />
        <h1 className="mb-3 text-2xl font-semibold leading-tight text-foreground">
          {t("browser.siteUnreachable")}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <Trans
            i18nKey="browser.connectionFailure"
            values={{ host, description: friendly }}
            components={{ host: <span className="font-semibold text-foreground" /> }}
          />
        </p>

        {showDetails ? (
          <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <p className="mb-2 font-medium text-foreground">{t("browser.try")}</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>{t("browser.checkConnection")}</li>
              <li>{t("browser.checkServer")}</li>
              {move ? <li>{t("browser.checkEnvironment")}</li> : null}
              <li>{t("browser.checkProxy")}</li>
            </ul>
          </div>
        ) : null}

        <div className="mt-8 text-xs uppercase tracking-wide text-muted-foreground/70">
          {errorLabel}
        </div>

        <div className="mt-auto flex items-center gap-2 pt-8">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowDetails((value) => !value)}
          >
            {t(showDetails ? "browser.hideDetails" : "browser.details")}
          </Button>
          <div className="flex-1" />
          {move ? (
            <Button type="button" variant="outline" size="sm" onClick={move.onMove}>
              {move.label}
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={onReload}>
            {t("browser.reload")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      className={className}
    >
      <path d="M16 12 L48 12 L48 52 L16 52 Z" />
      <path d="M22 22 L42 22 M22 30 L36 30 M22 38 L40 38" strokeLinecap="round" />
      <path d="M52 8 L12 56" strokeLinecap="round" />
    </svg>
  );
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
