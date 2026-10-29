import { CONVENE_DESKTOP_IDENTITY } from "@t3tools/shared/conveneDesktopIdentity";
import {
  isLanguagePreference,
  resolveLanguage,
  type LanguagePreference,
} from "@t3tools/client-runtime/i18n/languages";
import { CLIENT_SETTINGS_STORAGE_KEY } from "../clientSettingsStorageKey";

// Startup errors must render even when the React/i18next application chunk cannot load.
const appName = CONVENE_DESKTOP_IDENTITY.name;
const messages = {
  en: {
    failed: `${appName} could not load.`,
    reload: "Reload",
    offline: "This browser appears to be offline. Check the connection, then reload.",
    retry: "We are not sure why. Try a reload first.",
    more: "More options if it keeps failing",
    reinstall: `Download and reinstall ${appName}`,
    triage: `Run this on the computer that runs ${appName}. Your agent can check the local logs using this command.`,
    privacy: "Details may include local file paths and names. Check before sharing.",
    copyCommand: "Copy command",
    copyDetails: "Copy error details",
    copied: "Copied",
    copiedAnnouncement: "Copied to clipboard.",
    copyBlocked: "Copy was blocked. The text is selected so you can copy it manually.",
    copyMac: "Press ⌘C to copy",
    copyOther: "Press Ctrl+C to copy",
    download: "Download update",
    downloading: (percent: number) => `Downloading update (${percent}%)`,
    install: "Restart to update",
    downloadFailed: "The update download failed. Try Download update again.",
    installFailed: "The update install failed. Try Restart to update again.",
  },
  zh: {
    failed: `${appName} 无法加载。`,
    reload: "重新加载",
    offline: "此浏览器似乎已离线。请检查连接后重新加载。",
    retry: "暂时无法确定原因，请先重新加载。",
    more: "持续失败时的更多选项",
    reinstall: `下载并重新安装 ${appName}`,
    triage: `请在运行 ${appName} 的电脑上执行此命令，智能体可用它检查本地日志。`,
    privacy: "详情可能包含本地文件路径和名称，分享前请先检查。",
    copyCommand: "复制命令",
    copyDetails: "复制错误详情",
    copied: "已复制",
    copiedAnnouncement: "已复制到剪贴板。",
    copyBlocked: "复制被阻止，文本已选中，可手动复制。",
    copyMac: "按 ⌘C 复制",
    copyOther: "按 Ctrl+C 复制",
    download: "下载更新",
    downloading: (percent: number) => `正在下载更新（${percent}%）`,
    install: "重启并更新",
    downloadFailed: "更新下载失败，请再次点击“下载更新”。",
    installFailed: "更新安装失败，请再次点击“重启并更新”。",
  },
};
type BootMessages = (typeof messages)[keyof typeof messages];

function bootMessages() {
  let preference: LanguagePreference = "system";
  try {
    const raw =
      typeof window === "undefined"
        ? null
        : window.localStorage?.getItem(CLIENT_SETTINGS_STORAGE_KEY);
    const settings: unknown = raw ? JSON.parse(raw) : null;
    if (typeof settings === "object" && settings !== null && "languagePreference" in settings) {
      const value = settings.languagePreference;
      if (typeof value === "string" && isLanguagePreference(value)) preference = value;
    }
  } catch {
    // Storage failure can itself prevent app startup. The error surface still needs to work.
  }
  const locales = typeof navigator === "undefined" ? [] : navigator.languages;
  return messages[resolveLanguage(preference, locales)];
}

/** Shows startup failures before React can replace the boot splash. */
import type { DesktopBridge, DesktopUpdateState } from "@t3tools/contracts";

const FALLBACK_TRIAGE_COMMAND = `${CONVENE_DESKTOP_IDENTITY.executableName} triage`;
const LAST_FAILURE_KEY = "t3code:boot-failed-at";
const REPEAT_FAILURE_MS = 5 * 60_000;
const MAX_CAUSES = 3;
const MAX_ERROR_CHARS = 6_000;

/** The Windows launcher is a `.cmd` run from PowerShell, which needs `&` to run a quoted path. */
function launcherCommand(launcherPath: string) {
  if (launcherPath.endsWith(".cmd")) {
    return /^[\w:\\.-]+$/.test(launcherPath)
      ? launcherPath
      : `& '${launcherPath.replace(/['\u2018\u2019\u201A\u201B]/g, "$&$&")}'`;
  }
  return /^[\w@%+=:,./-]+$/.test(launcherPath)
    ? launcherPath
    : `'${launcherPath.replaceAll("'", `'"'"'`)}'`;
}

/** The bundled launcher works without Node; other hosts use the installed Convene CLI. */
export async function resolveTriageCommand(bridge: DesktopBridge | undefined) {
  try {
    const state = await bridge?.cliCommand?.getState();
    // Windows reports onPath from its PATH entry alone; only an existing launcher proves it runs.
    if (state?.launcherPath) {
      return state.onPath
        ? FALLBACK_TRIAGE_COMMAND
        : `${launcherCommand(state.launcherPath)} triage`;
    }
  } catch (error) {
    console.warn("Could not read the desktop CLI state.", error);
  }
  return FALLBACK_TRIAGE_COMMAND;
}

/** The update button only appears when the desktop updater has a newer build to offer. */
export function updateActionFor(state: DesktopUpdateState | null | undefined) {
  switch (state?.status) {
    case "available":
      return { kind: "download" } as const;
    case "downloading":
      return { kind: "downloading", percent: Math.round(state.downloadPercent ?? 0) } as const;
    case "downloaded":
      return { kind: "install" } as const;
    case "error":
      return state.canRetry && state.errorContext === "download"
        ? ({ kind: "download" } as const)
        : null;
    default:
      return null;
  }
}

function safeString(value: unknown) {
  try {
    return String(value);
  } catch {
    return "";
  }
}

function describeOne(value: unknown) {
  if (value instanceof Error) {
    const header = value.message ? `${value.name}: ${value.message}` : value.name;
    // V8 stacks start with the header; Safari and Firefox stacks do not.
    const stack = typeof value.stack === "string" ? value.stack : "";
    return stack === header || stack.startsWith(`${header}\n`)
      ? stack
      : [header, stack].filter(Boolean).join("\n");
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? safeString(value);
  } catch {
    return safeString(value);
  }
}

/** Hosts can name private machines, and pairing tokens live in query strings and hashes. */
function redact(text: string) {
  return text
    .replace(/\b[a-z][\w+.-]*:\/\/[^\s/?#'"()]+/gi, "")
    .replace(/[?#][^\s'"()]*=[^\s'"()]*?((?::\d+){1,2})?(?=[\s'"()]|$)/g, "$1");
}

export interface BootErrorEnvironment {
  readonly version: string;
  readonly channel: string;
  readonly surface: "desktop" | "web";
  readonly platform: string;
  readonly userAgent: string;
  readonly time: string;
}

/** Plain text that is shown and copied as-is, so users see exactly what they share. */
export function buildErrorReport(error: unknown, environment: BootErrorEnvironment) {
  const parts: Array<string> = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current != null && !seen.has(current) && parts.length <= MAX_CAUSES) {
    seen.add(current);
    const text = describeOne(current);
    parts.push(parts.length === 0 ? text : `Caused by: ${text}`);
    current = current instanceof Error ? current.cause : undefined;
  }
  let details = redact(parts.join("\n") || "(no error message)");
  if (details.length > MAX_ERROR_CHARS) {
    details = `${details.slice(0, MAX_ERROR_CHARS)}\n[truncated]`;
  }
  return [
    details,
    "",
    `Version: ${environment.version}`,
    `Channel: ${environment.channel}`,
    `Surface: ${environment.surface}`,
    `Platform: ${environment.platform}`,
    `User agent: ${environment.userAgent}`,
    `Time: ${environment.time}`,
  ].join("\n");
}

function clientPlatform(bridge: DesktopBridge | undefined) {
  try {
    return bridge?.getClientPlatform?.() ?? navigator.platform;
  } catch {
    return navigator.platform;
  }
}

function readEnvironment(bridge: DesktopBridge | undefined): BootErrorEnvironment {
  const version = import.meta.env.APP_VERSION;
  return {
    version,
    channel:
      import.meta.env.VITE_RELEASE_CHANNEL || /-(nightly|preview)\./.exec(version)?.[1] || "stable",
    surface: bridge ? "desktop" : "web",
    platform: clientPlatform(bridge),
    userAgent: navigator.userAgent,
    time: new Date().toISOString(),
  };
}

/** Opens More options by default when startup already failed in this tab a moment ago. */
function isRepeatFailure(now: number) {
  try {
    const previous = Number(sessionStorage.getItem(LAST_FAILURE_KEY));
    sessionStorage.setItem(LAST_FAILURE_KEY, String(now));
    return now - previous < REPEAT_FAILURE_MS;
  } catch {
    return false;
  }
}

const icon = (paths: string) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const COPY_ICON = icon(
  '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
);
const CHECK_ICON = icon('<path d="M20 6 9 17l-5-5"/>');

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: ReadonlyArray<Node | string> = [],
) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function selectContents(target: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(target);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function copySelection() {
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

/** Plain http has no Clipboard API, but the legacy copy command still works on a selection. */
function copyText(target: HTMLElement, onCopied: () => void, onBlocked: () => void) {
  const fallback = () => {
    selectContents(target);
    if (copySelection()) return onCopied();
    onBlocked();
  };
  const clipboard = window.isSecureContext ? navigator.clipboard : undefined;
  if (typeof clipboard?.writeText !== "function") return fallback();
  clipboard.writeText(target.textContent ?? "").then(onCopied, fallback);
}

function mountUpdateButton(
  bridge: DesktopBridge,
  button: HTMLButtonElement,
  note: HTMLParagraphElement,
  labels: () => BootMessages,
  downloads: (url: string | null) => void,
  announce: (text: string) => void,
) {
  let action: ReturnType<typeof updateActionFor> = null;
  let latest: DesktopUpdateState | null = null;
  const render = (state: DesktopUpdateState) => {
    latest = state;
    const text = labels();
    downloads(state.convene?.downloadsUrl ?? null);
    action = updateActionFor(state);
    button.hidden = action === null;
    // aria-disabled keeps keyboard focus on the button while the download runs.
    button.setAttribute("aria-disabled", String(action?.kind === "downloading"));
    if (action?.kind === "download") button.textContent = text.download;
    if (action?.kind === "downloading") button.textContent = text.downloading(action.percent);
    if (action?.kind === "install") button.textContent = text.install;
    const failure = !action
      ? ""
      : state.errorContext === "download"
        ? text.downloadFailed
        : state.errorContext === "install"
          ? text.installFailed
          : "";
    if (failure === note.textContent) return;
    note.textContent = failure;
    note.hidden = !failure;
    if (failure) announce(failure);
  };
  button.addEventListener("click", () => {
    const run =
      action?.kind === "install"
        ? bridge.installUpdate()
        : action?.kind === "download"
          ? bridge.downloadUpdate()
          : undefined;
    run?.then(
      (result) => render(result.state),
      (error: unknown) => console.warn(`Could not update ${appName}.`, error),
    );
  });
  // A pushed state is newer than the initial read, so the read must not overwrite it.
  let pushed = false;
  try {
    bridge.onUpdateState((state) => {
      pushed = true;
      render(state);
    });
    bridge.getUpdateState().then(
      (state) => {
        if (!pushed) render(state);
      },
      (error: unknown) => console.warn("Could not read the desktop update state.", error),
    );
  } catch (error) {
    console.warn("Could not read the desktop update state.", error);
  }
  return () => {
    if (latest) render(latest);
  };
}

export function showBootError(error: unknown) {
  console.error(`${appName} failed to start.`, error);
  const bootShell = document.getElementById("boot-shell");
  if (!bootShell) return;
  let labels = bootMessages();
  const bridge = window.desktopBridge;
  const environment = readEnvironment(bridge);
  const offline = !bridge && navigator.onLine === false;
  const status = element("span", { className: "boot-error-sr" });
  status.setAttribute("aria-live", "polite");
  // Clearing first makes screen readers announce a repeated message.
  let announcement: ReturnType<typeof setTimeout> | undefined;
  const announce = (text: string) => {
    clearTimeout(announcement);
    status.textContent = "";
    announcement = setTimeout(() => (status.textContent = text), 100);
  };
  const heading = element("h1");
  const explanation = element("p");
  const message = element("div", {}, [heading, explanation]);
  message.setAttribute("role", "alert");
  const reload = element("button", { id: "boot-error-reload", type: "button" });
  reload.addEventListener("click", () => window.location.reload());
  const update = element("button", { id: "boot-error-update", type: "button", hidden: true });
  const updateNote = element("p", { id: "boot-error-update-note", hidden: true });
  const command = element("code", { textContent: FALLBACK_TRIAGE_COMMAND });
  const copyCommand = element("button", {
    className: "boot-error-icon",
    type: "button",
    innerHTML: COPY_ICON,
  });
  let commandCopy: "idle" | "copied" | "blocked" = "idle";
  let detailsCopy: "idle" | "copied" | "blocked" = "idle";
  const manualCopyHint = () =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? labels.copyMac : labels.copyOther;
  const renderCommandCopy = () => {
    const text =
      commandCopy === "copied"
        ? labels.copied
        : commandCopy === "blocked"
          ? manualCopyHint()
          : labels.copyCommand;
    if (commandCopy === "blocked") copyCommand.textContent = text;
    copyCommand.title = text;
    copyCommand.setAttribute("aria-label", text);
  };
  copyCommand.addEventListener("click", () =>
    copyText(
      command,
      () => {
        commandCopy = "copied";
        copyCommand.innerHTML = CHECK_ICON;
        renderCommandCopy();
        announce(labels.copiedAnnouncement);
      },
      () => {
        commandCopy = "blocked";
        renderCommandCopy();
        announce(labels.copyBlocked);
      },
    ),
  );
  void resolveTriageCommand(bridge).then((value) => (command.textContent = value));
  let report = "(no error message)";
  try {
    report = buildErrorReport(error, environment);
  } catch (reportError) {
    console.warn("Could not describe the startup error.", reportError);
  }
  const details = element("pre", { id: "boot-error-details", tabIndex: 0, textContent: report });
  const copyDetails = element("button", { type: "button" });
  const renderDetailsCopy = () => {
    copyDetails.textContent =
      detailsCopy === "copied"
        ? labels.copied
        : detailsCopy === "blocked"
          ? manualCopyHint()
          : labels.copyDetails;
  };
  copyDetails.addEventListener("click", () =>
    copyText(
      details,
      () => {
        detailsCopy = "copied";
        renderDetailsCopy();
        announce(labels.copiedAnnouncement);
      },
      () => {
        detailsCopy = "blocked";
        renderDetailsCopy();
        announce(labels.copyBlocked);
      },
    ),
  );
  const reinstall = element("a", { target: "_blank", rel: "noreferrer", hidden: true });
  reinstall.addEventListener("click", (event) => {
    event.preventDefault();
    if (bridge && !reinstall.hidden) {
      void bridge
        .openExternal(reinstall.href)
        .catch((cause: unknown) =>
          console.warn("Could not open the Convene downloads page.", cause),
        );
    }
  });
  const summary = element("summary");
  const guidance = element("p");
  const privacy = element("p");
  const more = element("details", { open: isRepeatFailure(Date.now()) }, [
    summary,
    ...(bridge ? [reinstall] : []),
    element("div", {}, [
      guidance,
      element("div", { id: "boot-error-command" }, [command, copyCommand]),
    ]),
    element("div", {}, [
      details,
      privacy,
      element("div", { id: "boot-error-report" }, [copyDetails]),
    ]),
  ]);
  let refreshUpdateLabels = () => {};
  const renderLabels = () => {
    heading.textContent = labels.failed;
    explanation.textContent = offline ? labels.offline : labels.retry;
    reload.textContent = labels.reload;
    summary.textContent = labels.more;
    reinstall.textContent = labels.reinstall;
    guidance.textContent = labels.triage;
    privacy.textContent = labels.privacy;
    renderCommandCopy();
    renderDetailsCopy();
    refreshUpdateLabels();
  };
  renderLabels();
  bootShell.replaceChildren(
    element("div", { id: "boot-error" }, [
      message,
      element("div", { id: "boot-error-actions" }, [reload, update]),
      updateNote,
      more,
      status,
    ]),
  );
  if (bridge) {
    refreshUpdateLabels = mountUpdateButton(
      bridge,
      update,
      updateNote,
      () => labels,
      (url) => {
        reinstall.hidden = url === null;
        reinstall.href = url ?? "";
      },
      announce,
    );
    return bridge.getClientSettings().then(
      (settings) => {
        const locales = typeof navigator === "undefined" ? [] : navigator.languages;
        labels = messages[resolveLanguage(settings?.languagePreference ?? "system", locales)];
        renderLabels();
      },
      () => {
        /* Keep the working fallback when desktop settings cannot be read. */
      },
    );
  }
}
