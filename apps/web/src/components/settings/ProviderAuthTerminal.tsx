import { i18n, useTranslate } from "../../i18n";
import type { ProviderAuthResponse } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { GhosttyTerminalSurface } from "../../terminal/ghostty/surface";
import { ensureLocalApi } from "../../localApi";
import { useStableCallback } from "../../hooks/useStableCallback";
import { terminalThemeFromApp } from "../ThreadTerminalDrawer";

export default function ProviderAuthTerminal({
  output,
  outputOffset,
  onResponse,
}: {
  readonly output: string;
  readonly outputOffset?: number | undefined;
  readonly onResponse: (response: Extract<ProviderAuthResponse, { type: "terminal" }>) => void;
}) {
  const t = useTranslate();
  const [surface, setSurface] = useState<GhosttyTerminalSurface | null>(null);
  const written = useRef(0);
  useEffect(() => {
    surface?.setAccessibleLabels(t("terminal.inputLabel"), t("terminal.scrollbackLabel"));
  }, [surface, t]);
  const [error, setError] = useState<string | null>(null);
  // The surface captures its callbacks once at creation.
  const respond = useStableCallback(onResponse);
  const offset = outputOffset ?? output.length;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes new auth output into the imperative Ghostty terminal surface
  useEffect(() => {
    if (!surface) return;
    const delta = offset - written.current;
    if (delta > 0 && delta <= output.length) surface.write(output.slice(-delta));
    else if (delta !== 0) surface.resetAndWrite(output);
    written.current = offset;
  }, [surface, output, offset]);
  const mountSurface = (element: HTMLDivElement) => {
    let disposed = false;
    let created: GhosttyTerminalSurface | null = null;
    void GhosttyTerminalSurface.create(element, {
      theme: terminalThemeFromApp(element),
      accessibleLabels: {
        input: i18n.t("terminal.inputLabel"),
        scrollback: i18n.t("terminal.scrollbackLabel"),
      },
      font: { size: 13 },
      onData: (data) => respond({ type: "terminal", data }),
      onResize: (cols, rows) => respond({ type: "terminal", data: "", size: { cols, rows } }),
      onSelectionChange: () => {},
      beforeKey: (event) => event.key !== "Tab",
      onLinkActivate: (url) => {
        if (/^https?:\/\//i.test(url))
          void ensureLocalApi()
            .shell.openExternal(url)
            .catch(() => setError("provider.setup.openProviderLinkFailed"));
      },
    })
      .then((terminal) => {
        if (disposed) {
          terminal.dispose();
          return;
        }
        created = terminal;
        terminal.setAccessibleLabels(
          i18n.t("terminal.inputLabel"),
          i18n.t("terminal.scrollbackLabel"),
        );
        written.current = 0;
        setSurface(terminal);
      })
      .catch(() => setError("provider.setup.terminalLoadFailed"));
    return () => {
      disposed = true;
      created?.dispose();
      setSurface(null);
    };
  };
  return (
    <>
      <div
        ref={mountSurface}
        aria-label={t("provider.setup.signInTerminal")}
        className="relative h-64 overflow-hidden rounded-md border border-border"
      />
      {error ? (
        <p role="alert" className="text-destructive">
          {t(error)}
        </p>
      ) : null}
    </>
  );
}
