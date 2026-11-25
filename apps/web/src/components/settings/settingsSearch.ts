import type { TFunction } from "i18next";
import { useTranslate, i18n } from "../../i18n";
import { HOSTED_APP_CHANNEL } from "~/branding";
import { isElectron } from "~/env";
import { isMacPlatform, isWindowsPlatform, normalizeSearchText } from "~/lib/utils";
import { STATIC_KEYBINDING_COMMANDS, type KeybindingCommand } from "@t3tools/contracts";
import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import {
  sourceControlClients,
  type SourceControlDefinition,
} from "@t3tools/client-runtime/source-control-clients";
import { DEFAULT_KEYBINDINGS } from "@t3tools/shared/keybindings";
import * as Schema from "effect/Schema";
import { decodeMsg, msg, useMessages } from "gt-react";
import { TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "../../appearanceFonts";
import { writeLocalStorageValue } from "../../hooks/useLocalStorage";
import { m, type MessageResolver } from "../../i18n/messages";
import { commandLabel, keybindingCommandSearchLabels } from "./KeybindingsSettings.logic";
import type { ResolvedSettingsScope } from "./settingsScope";

export type SettingsPath =
  | "/settings/convene"
  | "/settings/projects"
  | "/settings/general"
  | "/settings/diagnostics"
  | "/settings/voice"
  | "/settings/appearance"
  | "/settings/chat"
  | "/settings/diffs"
  | "/settings/keybindings"
  | "/settings/snap-shot"
  | "/settings/providers"
  | "/settings/threads"
  | "/settings/browser"
  | "/settings/devices"
  | "/settings/scheduled-tasks"
  | "/settings/source-control"
  | "/settings/worktrees"
  | "/settings/connections"
  | "/settings/access"
  | "/settings/secrets"
  | "/settings/maintenance"
  | "/settings/labs"
  | "/settings/about"
  | "/settings/archived";

export type SettingsSearchScope =
  | "environment"
  | "environment-defaults"
  | "project-defaults"
  | "project"
  | "checkout"
  | "connections";

export interface SettingsSearchItem {
  readonly id: string;
  readonly title: string;
  readonly titleKey?: string;
  readonly to: SettingsPath;
  readonly targetId?: string;
  readonly searchTerms?: ReadonlyArray<string>;
  readonly scope?: SettingsSearchScope;
  readonly desktopOnly?: boolean;
  readonly macOnly?: boolean;
  readonly windowsOnly?: boolean;
  readonly releaseChannelOnly?: boolean;
  readonly secretProvidersOnly?: boolean;
  readonly cloudOnly?: boolean;
  readonly environmentOnly?: boolean;
  readonly providerSettingsOnly?: boolean;
  readonly macProviderSettingsOnly?: boolean;
  readonly localBackendManagementOnly?: boolean;
  readonly localEnvironmentOnly?: boolean;
  readonly primaryEnvironmentOnly?: boolean;
  readonly wslAvailableOnly?: boolean;
  readonly managedTunnelOnly?: boolean;
  readonly peerLinksOnly?: boolean;
  readonly fastWorktreeCheckoutOnly?: boolean;
  readonly textGeneratorsOnly?: boolean;
  readonly secondary?: boolean;
  readonly requiresThreadAutoSettlement?: boolean;
}

export interface SettingsSearchAvailability {
  readonly localEnvironmentDisabled?: boolean;
  readonly hasCloudPublicConfig: boolean;
  readonly hasEnvironment: boolean;
  readonly hasProviderSettingsEnvironment: boolean;
  readonly hasMacProviderSettingsEnvironment?: boolean;
  readonly canManageLocalBackend: boolean;
  readonly isWslSettingsRowVisible: boolean;
  readonly hasThreadAutoSettlement: boolean;
  readonly managedTunnelActive?: boolean;
  readonly hasPeerLinkHost?: boolean;
  readonly hasFastWorktreeCheckoutEnvironment?: boolean;
  /** An environment without a provider allow-list, which hides text generators. */
  readonly hasTextGeneratorsEnvironment?: boolean;
  readonly hasPrimaryEnvironment?: boolean;
  readonly hasSecretProvidersEnvironment?: boolean;
}

export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsPath, string>> = {
  "/settings/convene": "Convene",
  "/settings/diagnostics": msg("Diagnostics"),
  "/settings/projects": msg("Projects"),
  "/settings/general": msg("General"),
  "/settings/appearance": msg("Appearance"),
  "/settings/chat": msg("Chat"),
  "/settings/diffs": msg("Diffs & pull requests"),
  "/settings/keybindings": msg("Keybindings"),
  "/settings/snap-shot": msg("SnapShots"),
  "/settings/providers": msg("Providers"),
  "/settings/threads": msg("Threads"),
  "/settings/browser": msg("Browser"),
  "/settings/devices": msg("Devices"),
  "/settings/scheduled-tasks": msg("Scheduled tasks"),
  "/settings/source-control": msg("Source control & issues"),
  "/settings/worktrees": msg("Worktrees"),
  "/settings/connections": msg("Environments"),
  "/settings/access": msg("Sharing & access"),
  "/settings/secrets": msg("Secrets"),
  "/settings/maintenance": msg("Maintenance"),
  "/settings/labs": msg("Labs"),
  "/settings/about": msg("About"),
  "/settings/voice": msg("Voice"),
  "/settings/archived": msg("Archive"),
};

/** Sidebar labels; an entry of its own lets a translator shorten one below its page title. */
export const SETTINGS_NAV_LABELS: Readonly<Record<SettingsPath, string>> = {
  ...SETTINGS_SECTION_LABELS,
  "/settings/source-control": msg("Source control & issues", {
    $context: "settings navigation item",
  }),
  "/settings/access": msg("Sharing & access", { $context: "settings navigation item" }),
};

type SettingsNavGroup = {
  readonly heading: string;
  readonly headingHidden?: true;
  readonly paths: ReadonlyArray<SettingsPath>;
};

/** Sidebar order. A group with a hidden heading is set apart on screen by space alone. */
const ALL_SETTINGS_NAV_GROUPS: ReadonlyArray<SettingsNavGroup> = [
  {
    heading: msg("Preferences"),
    headingHidden: true,
    paths: [
      "/settings/general",
      "/settings/appearance",
      "/settings/chat",
      "/settings/diffs",
      "/settings/keybindings",
      "/settings/voice",
      "/settings/snap-shot",
    ],
  },
  {
    heading: msg("Agents"),
    paths: [
      "/settings/providers",
      "/settings/threads",
      "/settings/browser",
      "/settings/devices",
      "/settings/scheduled-tasks",
    ],
  },
  {
    heading: msg("Code"),
    paths: ["/settings/projects", "/settings/source-control", "/settings/worktrees"],
  },
  {
    heading: msg("Connections"),
    paths: ["/settings/connections", "/settings/convene", "/settings/access", "/settings/secrets"],
  },
  {
    heading: msg("More"),
    headingHidden: true,
    paths: ["/settings/maintenance", "/settings/labs", "/settings/about", "/settings/archived"],
  },
];

const SETTINGS_NAV_GROUPS_WITHOUT_SECRETS = ALL_SETTINGS_NAV_GROUPS.map((group) => ({
  ...group,
  paths: group.paths.filter((path) => path !== "/settings/secrets"),
}));

/** Sidebar groups; Secrets shows only when some environment's server enables secret providers. */
export function settingsNavGroups(hasSecretProvidersEnvironment: boolean) {
  return hasSecretProvidersEnvironment
    ? ALL_SETTINGS_NAV_GROUPS
    : SETTINGS_NAV_GROUPS_WITHOUT_SECRETS;
}

export function keybindingSearchAnchorId<Command extends KeybindingCommand>(command: Command) {
  return `keybinding-${command}` as const;
}

const untranslated = ((message) => message) as MessageResolver;

const KEYBINDING_SEARCH_ITEMS = STATIC_KEYBINDING_COMMANDS.toSorted((left, right) =>
  commandLabel(left).localeCompare(commandLabel(right)),
).map((command) => {
  const defaultKeys = DEFAULT_KEYBINDINGS.filter((binding) => binding.command === command).map(
    (binding) => binding.key,
  );
  const titleKey = `keybindings.command.${command}`;
  return {
    id: keybindingSearchAnchorId(command),
    title: commandLabel(command, untranslated),
    titleKey,
    to: "/settings/keybindings" as const,
    searchTerms: [command, ...keybindingCommandSearchLabels(command), ...defaultKeys],
    secondary: true,
    ...(defaultKeys.length === 0 ? { targetId: "keybindings" } : {}),
  };
});

export function sourceControlHostSettingsSearchId(kind: string) {
  return `source-control-host-${kind}` as const;
}

/** Each host's own settings: its accounts and token, or the fields of its settings form. */
export function sourceControlHostSearchItems(
  definitions: ReadonlyArray<SourceControlDefinition>,
): ReadonlyArray<
  SettingsSearchItem & { readonly id: ReturnType<typeof sourceControlHostSettingsSearchId> }
> {
  return definitions.flatMap((definition) => {
    if (!definition.settings) return [];
    const names = [definition.label, ...(definition.searchKeywords ?? [])].join(" ");
    const { credentials } = definition;
    return [
      {
        id: sourceControlHostSettingsSearchId(definition.kind),
        title: credentials
          ? msg("{label} accounts and token", { label: definition.label })
          : msg("{label} credentials", { label: definition.label }),
        to: "/settings/source-control" as const,
        searchTerms: [
          credentials
            ? `${names} ${credentials.cliName} account login user host switch multiple accounts disable sign in token personal access token pat api key credential 当前账户 账户 登录 切换 令牌 凭据`
            : `${names} ${Object.keys(definition.settings.fields).join(" ")} token credentials sign in 账户邮箱 令牌 凭据`,
          ...Object.keys(definition.settings.fields).flatMap((key) =>
            ["en", "zh"].map((language) =>
              i18n.getFixedT(language)(`sourceControl.fields.${definition.kind}.${key}.label`, {
                defaultValue: key,
              }),
            ),
          ),
        ],
        environmentOnly: true,
        scope: "environment-defaults" as const,
      },
    ];
  });
}

/** For settings that apply to every host. */
const SOURCE_CONTROL_HOST_LABELS = sourceControlClients.definitions
  .map((definition) => definition.label)
  .join(" ");
const SOURCE_CONTROL_HOST_TERMS = sourceControlClients.definitions
  .flatMap((definition) => [definition.label, ...(definition.searchKeywords ?? [])])
  .join(" ");

export const SETTINGS_SEARCH_ITEMS = [
  {
    id: "convene-connection",
    titleKey: "convene.connection.connect",
    get title() {
      return i18n.t("convene.connection.connect");
    },
    to: "/settings/convene",
    searchTerms: ["Convene pairing modules MCP client activation", "Convene 配对 连接 模块 授权"],
  },
  {
    id: "codex-native-predictions",
    titleKey: "prediction.setting.label",
    get title() {
      return i18n.t("prediction.setting.label");
    },
    to: "/settings/chat",
    searchTerms: [
      "codex prediction suggestion native experimental off manual auto shortcut 预测 建议 原生 实验 关闭 手动 自动 快捷键",
    ],
  },

  {
    id: "legacy-context-window-indicator",
    titleKey: "legacy.context.label",
    get title() {
      return i18n.t("legacy.context.label");
    },
    to: "/settings/chat",
    searchTerms: ["context window indicator token meter 上下文窗口 用量 指示器"],
  },

  {
    id: "desktop-updates",
    titleKey: "update.search.title",
    get title() {
      return i18n.t("update.search.title");
    },
    to: "/settings/about",
    desktopOnly: true,
    targetId: "app-version",
    searchTerms: [
      "Desktop updates check for updates update track stable nightly releases download install restart",
      "桌面更新 应用更新 检查更新 更新渠道 稳定版 每日构建版 下载 安装 重启",
    ],
  },

  {
    id: "storage-worktree-keep-when",
    targetId: "storage-worktrees",
    title: msg("Keep worktrees with local changes"),
    to: "/settings/worktrees",
    scope: "project-defaults",
    searchTerms: [
      msg(
        "any local files uncommitted changes edited tracked files ignored env build output cleanup",
      ),
    ],
  },
  {
    id: "storage-delete-now",
    title: msg("Delete now"),
    to: "/settings/maintenance",
    scope: "environment-defaults",
    searchTerms: [msg("storage cleanup run now results report removed kept failed")],
  },
  {
    id: "storage-worktrees",
    title: msg("Worktree cleanup"),
    to: "/settings/worktrees",
    scope: "project-defaults",
    searchTerms: [
      "Git 工作树清理 删除会话 闲置 已合并 无新提交 保留天数 继承 自定义 闲置工作树 合并工作树",
      msg(
        "disk storage automatic delete deleted archived threads old inactive merged settled unchanged worktrees retention days project inherit off custom",
      ),
    ],
  },
  {
    id: "storage-worktrees-location",
    title: msg("Worktree location"),
    to: "/settings/worktrees",
    scope: "environment-defaults",
    searchTerms: [
      "Git 工作树位置 目录 磁盘 存放路径",
      msg("worktree location folder directory path drive external disk"),
    ],
  },
  {
    id: "storage-artifacts",
    title: msg("Artifacts and logs"),
    to: "/settings/maintenance",
    scope: "environment-defaults",
    searchTerms: [
      "产物 日志 浏览器采集 浏览器产物 截图 录屏 轮转日志 清理 保留天数",
      msg(
        "disk storage delete old browser artifacts screenshots captures rotated logs cleanup retention",
      ),
    ],
  },
  {
    id: "project-defaults",
    title: msg("Project defaults and overrides"),
    to: "/settings/threads",
    scope: "project-defaults",
    searchTerms: [
      "Project defaults and overrides 项目默认值与覆盖设置",
      msg("model workspace environments projects inheritance checkout"),
    ],
  },
  {
    id: "project-overview",
    title: msg("Project overview"),
    to: "/settings/projects",
    searchTerms: [msg("name icon emoji image checkout remove delete")],
  },
  {
    id: "default-model",
    title: msg("Default model"),
    to: "/settings/threads",
    scope: "project-defaults",
    searchTerms: ["Default model 默认模型", msg("new thread project provider reasoning effort")],
  },
  {
    id: "fallback-model",
    title: msg("Fallback model"),
    to: "/settings/threads",
    scope: "environment-defaults",
    searchTerms: [
      "备用模型 fallback agent model provider out of usage limit new threads",
      msg("fallback agent provider out of usage new threads"),
    ],
    environmentOnly: true,
  },
  {
    id: "default-permissions",
    title: msg("Permissions"),
    to: "/settings/threads",
    scope: "project-defaults",
    searchTerms: [
      "Permissions 权限",
      msg("new thread default runtime mode supervised approvals auto accept edits full access"),
    ],
  },
  {
    id: "color-scheme",
    title: msg("Color scheme"),
    to: "/settings/appearance",
    searchTerms: ["颜色模式 浅色 深色 跟随系统外观", msg("appearance light dark system mode")],
    targetId: "appearance",
  },
  {
    id: "theme",
    title: msg("Themes"),
    to: "/settings/appearance",
    searchTerms: [
      "主题 外观 颜色 配色 自定义 导入 社区主题 搜索主题 安装主题 JSON 文件",
      msg("appearance colors palette custom import"),
    ],
    targetId: "appearance",
  },
  {
    // Prefixed because the slider control already owns the `appearance-contrast` id.
    id: "setting-appearance-contrast",
    title: msg("Contrast"),
    to: "/settings/appearance",
    searchTerms: ["对比度 颜色 边框 界面", msg("colors borders interface")],
  },
  {
    // Prefixed because the slider control already owns the `glass-opacity` id.
    id: "setting-glass-opacity",
    title: msg("Glass opacity"),
    to: "/settings/appearance",
    searchTerms: [
      "玻璃效果 不透明度 透明度 菜单 对话框 输入框",
      msg("transparent transparency solid menus dialogs composer"),
    ],
  },
  {
    id: "diff-color-scheme",
    title: msg("Diff colors"),
    to: "/settings/diffs",
    searchTerms: [
      "差异颜色 红绿 蓝橙 新增 删除 变更计数 色盲",
      msg("red green blue orange additions deletions changes counts palette colorblind"),
    ],
  },
  {
    id: "chat-width",
    title: msg("Chat width"),
    to: "/settings/appearance",
    searchTerms: [
      "聊天宽度 适中 全宽 大屏幕 消息 输入框",
      msg("wide full width column layout messages composer monitor"),
    ],
  },
  {
    id: "html-preview-width",
    title: msg("HTML preview width"),
    to: "/settings/appearance",
    searchTerms: [msg("wide full width inline page render chart dashboard artifact centered")],
  },
  {
    id: "thread-details-items",
    title: msg("Thread details"),
    to: "/settings/appearance",
    searchTerms: [
      msg(
        "customize show hide panel card environment editor scripts branch pull request git changes servers automations lineage usage limits 5 hour weekly quota tokens context window",
      ),
    ],
  },
  {
    id: "effort-display",
    title: msg("Effort display"),
    to: "/settings/appearance",
    searchTerms: [msg("reasoning effort thinking bars graph word label level composer")],
  },
  {
    id: "math-rendering",
    title: msg("Render math"),
    to: "/settings/appearance",
    searchTerms: [msg("latex tex katex equations formulas markdown")],
  },
  {
    id: "panel-animations",
    title: msg("Panel animations"),
    to: "/settings/appearance",
    searchTerms: ["面板动画 展开 收起 动效 动画时长 毫秒"],
  },
  {
    id: "environment-identification",
    title: msg("Environment identification"),
    to: "/settings/appearance",
    searchTerms: [
      "环境标识 开发版 Nightly 图形标识 版本标签 不显示",
      msg("dev nightly latest channel artwork pill label hide none"),
    ],
    targetId: "appearance-interface",
  },
  {
    id: "interface-font",
    title: msg("Interface font"),
    to: "/settings/appearance",
    searchTerms: ["界面字体 字体家族 字号 系统字体", msg("typography family size system sans")],
  },
  {
    id: "prompt-font",
    title: msg("Prompt font"),
    to: "/settings/appearance",
    searchTerms: ["提示词字体 输入框字体 字号 等宽", msg("typography family size composer input")],
  },
  {
    id: "code-font",
    title: msg("Code font"),
    to: "/settings/appearance",
    searchTerms: [
      "代码字体 等宽字体 字号 差异 文件预览",
      msg("typography family size monospace code blocks diffs file previews"),
    ],
  },
  {
    id: "terminal-font",
    title: msg("Terminal font"),
    to: "/settings/appearance",
    searchTerms: ["终端字体 等宽字体 字号 输出", msg("typography family size monospace output")],
  },
  {
    id: "separate-fonts",
    title: msg("Separate fonts"),
    to: "/settings/appearance",
    searchTerms: [msg("typography advanced prompt code terminal font family size individually")],
  },
  {
    id: "font-smoothing",
    title: msg("Font smoothing"),
    to: "/settings/appearance",
    searchTerms: [
      "字体平滑 灰度 抗锯齿 macOS 纤细",
      msg("typography text grayscale anti aliasing macos thin"),
    ],
    macOnly: true,
  },
  {
    id: "word-wrap",
    title: msg("Word wrap"),
    to: "/settings/appearance",
    searchTerms: [
      "自动换行 长行 代码 差异 文件预览",
      msg("long lines code blocks diffs file previews"),
    ],
  },
  {
    id: "composer-context",
    title: msg("Composer context"),
    to: "/settings/appearance",
    searchTerms: ["输入框上下文 分支 Git 工作树 控件 保留"],
  },
  {
    id: "project-grouping",
    title: msg("Project grouping"),
    to: "/settings/general",
    searchTerms: [
      "Project grouping 项目分组",
      msg("combine matching repositories environments sidebar"),
    ],
  },
  {
    id: "project-order",
    title: msg("Project order"),
    to: "/settings/general",
    searchTerms: ["Project order 项目顺序", msg("sort projects sidebar manual created recent")],
  },
  {
    id: "snooze-options",
    title: msg("Snooze options"),
    to: "/settings/threads",
    searchTerms: [
      "snooze presets times later tonight tomorrow next week remind 暂缓 选项 预设 唤醒 提醒",
      msg("snooze presets times later tonight tomorrow next week remind"),
    ],
    environmentOnly: true,
    scope: "environment-defaults",
  },
  {
    id: "snooze-limited-threads",
    title: msg("Snooze until limits reset"),
    to: "/settings/threads",
    searchTerms: [
      "Snooze limited threads 暂缓受用量限制的会话",
      msg("usage quota rate limit reset wake recover continue"),
    ],
  },
  {
    id: "auto-resume-limited-threads",
    title: msg("Resume after usage limits"),
    to: "/settings/threads",
    searchTerms: [
      "Auto-resume limited threads 额度重置后自动继续会话",
      msg("usage quota rate limit reset recover continue"),
    ],
  },
  {
    id: "working-shelf",
    title: msg("Working section"),
    to: "/settings/general",
    searchTerms: [
      "Working section (beta) “进行中”分区（测试版）",
      msg("hide fold running monitoring threads inbox sidebar shelf"),
    ],
  },
  {
    id: "boring-sidebar",
    title: msg("Boring sidebar (group by project)"),
    to: "/settings/labs",
    searchTerms: [
      "beta folders project tree legacy old classic sidebar 简洁侧栏 按项目分组",
      msg("beta folders project tree classic sidebar"),
    ],
  },
  {
    id: "boring-sidebar-multiline",
    title: msg("Two-line folder rows"),
    to: "/settings/labs",
    // Shown inside the boring sidebar row only while it is on, so search lands on the parent.
    targetId: "boring-sidebar",
    searchTerms: [
      "beta boring sidebar folder rows multiline branch pull request details 双行 文件夹",
      msg("beta boring sidebar folder rows multiline branch pull request details"),
    ],
  },

  {
    id: "tool-call-visibility",
    title: msg("Tool calls in chat"),
    to: "/settings/chat",
    searchTerms: [
      msg(
        "hide tool calls commands edits searches work log activity quiet chat zen final answers only",
      ),
    ],
  },
  {
    id: "screen-reader-announcements",
    title: msg("Screen reader announcements"),
    to: "/settings/chat",
    searchTerms: [
      "屏幕阅读器 无障碍 播报 朗读 状态 消息 步骤",
      msg(
        "accessibility a11y screen reader nvda jaws voiceover orca narrator speech announce read aloud messages activity steps",
      ),
    ],
  },
  {
    id: "screen-reader-window-title",
    title: msg("Screen reader window title"),
    to: "/settings/chat",
    searchTerms: [
      msg(
        "accessibility a11y screen reader nvda jaws voiceover orca narrator window title tab title alt tab taskbar thread status order working approval",
      ),
    ],
  },
  {
    id: "guest-links",
    title: msg("Guest links"),
    to: "/settings/labs",
    scope: "environment",
    searchTerms: [msg("beta share guest invite link teammate watch t3 connect tunnel")],
  },
  {
    id: "linked-environments-beta",
    title: msg("Linked environments"),
    to: "/settings/labs",
    scope: "environment",
    searchTerms: [msg("beta link another machine vps peer agents work there delegate")],
  },
  {
    id: "workflows-beta",
    title: msg("Workflows"),
    to: "/settings/labs",
    scope: "environment",
    searchTerms: [msg("beta workflow durable runs automation steps schedule webhook folder")],
  },
  {
    id: "workflow-skipped-runs",
    title: msg("Skipped runs kept"),
    to: "/settings/labs",
    // Shown only while workflows are on, so search lands on the switch that turns them on.
    targetId: "workflows-beta",
    scope: "environment",
    searchTerms: [msg("workflow history retention delete old skipped runs webhook")],
  },
  {
    id: "prompt-suggestions-beta",
    title: msg("Suggest next prompt"),
    to: "/settings/labs",
    scope: "environment",
    searchTerms: [msg("beta tab autocomplete predict next message claude codex ghost text")],
  },
  {
    id: "simlock-hosts",
    title: msg("Simlock device hosts (alpha)"),
    to: "/settings/labs",
    scope: "environment",
    searchTerms: [
      msg("beta alpha simlock callstack simulator emulator ios android pool lease gateway"),
    ],
  },
  {
    id: "worktree-fast-checkout",
    title: msg("Fast worktree checkout"),
    to: "/settings/labs",
    scope: "environment",
    fastWorktreeCheckoutOnly: true,
    searchTerms: [msg("beta fast worktree checkout clone apfs copy-on-write cache macos speed")],
  },
  {
    id: "voice-transcription-destination",
    title: msg("Transcribe with"),
    to: "/settings/voice",
    searchTerms: [
      msg(
        "send microphone audio dictation destination speech voice stt transcription environment machine consent privacy cloud OpenAI Grok OpenRouter",
      ),
    ],
  },
  {
    id: "voice-microphone",
    title: msg("Microphone"),
    to: "/settings/voice",
    searchTerms: [msg("mic input audio device order priority preferred")],
  },
  {
    id: "dictation-shortcut-mode",
    title: msg("Dictation shortcut"),
    to: "/settings/voice",
    searchTerms: [msg("speech voice keyboard hotkey hold toggle auto")],
  },
  {
    id: "speech-language",
    title: msg("Transcription language"),
    to: "/settings/voice",
    searchTerms: [msg("speech voice translate english auto detect")],
  },
  {
    id: "speech-dictionary",
    title: msg("Dictionary"),
    to: "/settings/voice",
    searchTerms: [msg("speech voice transcription vocabulary names glossary alias")],
  },
  {
    id: "speech-project-dictionary",
    title: msg("Project dictionary"),
    to: "/settings/voice",
    scope: "project-defaults",
    searchTerms: [
      msg("speech voice transcription vocabulary shared dictionary team environment glossary"),
    ],
  },
  {
    id: "speech-post-processing-model",
    title: msg("Cleanup model"),
    to: "/settings/voice",
    scope: "environment",
    searchTerms: [msg("speech voice transcript cleanup provider model post-processing")],
  },
  {
    id: "speech-correction-word",
    title: msg("Correction cue"),
    to: "/settings/voice",
    searchTerms: [msg("speech voice cleanup sorry scratch that fix mistake")],
  },
  {
    id: "speech-silence-filtering",
    title: msg("Silence filtering"),
    to: "/settings/voice",
    searchTerms: [msg("voice speech vad silero pauses noise")],
  },
  {
    id: "remove-filler-words",
    title: msg("Remove filler words"),
    to: "/settings/voice",
    searchTerms: [msg("voice speech transcription hesitation um uh cleanup")],
  },
  {
    id: "speech-post-processing",
    title: msg("Clean up transcripts"),
    to: "/settings/voice",
    searchTerms: [msg("speech transcription polish clean provider prompt post-processing")],
  },
  {
    id: "speech-models",
    title: msg("Transcription models"),
    to: "/settings/voice",
    searchTerms: [
      msg(
        "speech voice stt download whisper parakeet canary moonshine accuracy speed benchmark languages",
      ),
    ],
  },
  {
    id: "speech-hardware",
    title: msg("Transcription hardware and model unloading"),
    to: "/settings/voice",
    searchTerms: [msg("speech voice stt advanced gpu cpu acceleration memory unload idle")],
  },
  {
    id: "speech-streaming",
    title: msg("Streaming transcription"),
    to: "/settings/voice",
    searchTerms: [
      msg("speech voice stt advanced native live preview batch after stopping slow lag"),
    ],
  },
  {
    id: "microphone-test",
    title: msg("Test microphone"),
    to: "/settings/voice",
    searchTerms: [msg("test mic audio playback loopback record input level")],
  },
  {
    id: "transcription-test",
    title: msg("Test model"),
    to: "/settings/voice",
    searchTerms: [msg("test voice speech model transcription recognition")],
  },
  {
    id: "auto-settle-inactive-threads",
    title: msg("Auto-settle inactive threads"),
    to: "/settings/threads",
    searchTerms: [
      "Auto-settle inactive threads 自动完成不活跃会话",
      msg("sidebar inactivity days no activity automatically"),
    ],
    requiresThreadAutoSettlement: true,
    scope: "project-defaults",
  },
  {
    id: "compact-idle-threads",
    title: msg("Compact idle threads"),
    to: "/settings/providers",
    scope: "environment-defaults",
    searchTerms: [msg("claude context compaction idle cache tokens usage summary resume")],
  },
  {
    id: "auto-settle-merged-threads",
    title: msg("Auto-settle merged threads"),
    to: "/settings/threads",
    searchTerms: [
      "Auto-settle merged threads 合并后自动完成会话",
      msg("pull request merge closed automatically sidebar"),
    ],
    requiresThreadAutoSettlement: true,
    scope: "project-defaults",
  },
  {
    id: "keep-threads-with-pull-requests",
    title: msg("Keep threads with a PR"),
    to: "/settings/threads",
    targetId: "auto-settle-inactive-threads",
    searchTerms: [msg("pull request inactivity auto-settle merge close sidebar")],
    requiresThreadAutoSettlement: true,
    scope: "project-defaults",
  },
  {
    id: "days-before-auto-settle",
    title: msg("Days of inactivity before auto-settle"),
    to: "/settings/threads",
    targetId: "auto-settle-inactive-threads",
    searchTerms: [
      "Days of inactivity before auto-settle 自动完成前的无活动天数",
      msg("thread timeout activity sidebar"),
    ],
    requiresThreadAutoSettlement: true,
    scope: "project-defaults",
  },
  {
    id: "thread-notifications",
    title: msg("Thread notifications"),
    to: "/settings/general",
    searchTerms: [
      "Thread notifications 会话通知",
      msg("notification sound alert completion input approval desktop"),
    ],
  },
  {
    id: "in-app-notifications",
    title: msg("In-app notifications"),
    to: "/settings/general",
    searchTerms: [
      "In-app notifications 应用内通知",
      msg("notification toast popup completion input approval failure"),
    ],
  },
  {
    id: "language",
    title: msg("Language"),
    to: "/settings/general",
    searchTerms: [
      "locale translation english deutsch german español spanish français french português portuguese brasil brazilian chinese 中文 japanese 日本語 korean 한국어 russian русский sprache idioma langue 语言 言語 언어 язык",
      msg(
        "locale translation english deutsch german español spanish français french português portuguese brasil brazilian chinese 中文 japanese 日本語 korean 한국어 russian русский swedish svenska sprache idioma langue 语言 言語 언어 язык",
      ),
    ],
  },
  {
    id: "time-format",
    title: msg("Time format"),
    to: "/settings/general",
    searchTerms: [
      "Time format 时间格式",
      msg("timestamp clock locale system browser os 12 hour 24 hour"),
    ],
  },
  {
    id: "response-streaming",
    title: msg("Response streaming"),
    to: "/settings/threads",
    scope: "project-defaults",
    searchTerms: [
      "Response streaming 响应显示方式",
      msg("output token paragraph buffered wait turn legacy"),
    ],
  },
  {
    id: "hide-whitespace-changes",
    title: msg("Hide whitespace changes"),
    to: "/settings/diffs",
    searchTerms: [
      "Hide whitespace changes 隐藏空白字符变化",
      msg("diff ignore spaces edits default"),
    ],
  },
  {
    id: "default-diff-file-state",
    title: msg("Default diff file state"),
    to: "/settings/diffs",
    searchTerms: [
      "Default diff file state 差异文件默认状态",
      msg("collapsed expanded collapse expand files pull request pr code tab"),
    ],
  },
  {
    id: "diff-layout",
    title: msg("Diff layout"),
    to: "/settings/diffs",
    searchTerms: ["Diff layout 差异布局", msg("stacked split side by side unified inline view")],
  },
  {
    id: "proactive-panels",
    title: msg("Open pull requests and changes panels proactively"),
    to: "/settings/diffs",
    searchTerms: [
      "Proactive panels 自动打开相关面板",
      msg("proactive automatically open diff pull request pr right panel agent completion"),
    ],
  },
  {
    id: "skills-in-slash-menu",
    title: msg("Show skills in slash menu"),
    to: "/settings/chat",
    searchTerms: [
      "Show skills in slash menu 在斜杠菜单中显示技能",
      msg("command menu dollar $ slash /"),
    ],
  },
  {
    id: "composer-rich-text",
    title: msg("Rich text composer"),
    to: "/settings/chat",
    searchTerms: [
      "Rich text composer 富文本输入框",
      msg("composer rich text tiptap bold italic markdown styled wysiwyg"),
    ],
  },
  {
    id: "send-shortcut",
    title: msg("Send shortcut"),
    to: "/settings/chat",
    searchTerms: [
      "Send shortcut 发送快捷键",
      msg("enter return command ctrl multiline prompt new line composer"),
    ],
  },
  {
    id: "follow-up-behavior",
    title: msg("Follow-up behavior"),
    to: "/settings/chat",
    searchTerms: [
      "Follow-up behavior 后续消息处理方式",
      msg("queue steer running turn send default behavior composer"),
    ],
  },
  {
    id: "side-thread-open-target",
    title: msg("Open subagents and side chats in"),
    to: "/settings/chat",
    searchTerms: [
      msg(
        "subagent side chat linked thread click right panel side panel main view command ctrl middle click",
      ),
    ],
  },
  {
    id: "provider-update-checks",
    title: msg("Provider update checks"),
    to: "/settings/maintenance",
    searchTerms: [
      "Provider update checks 智能体提供方版本检查",
      msg("installed cli versions newer available codex claude cursor grok fx kiro opencode"),
    ],
    scope: "environment-defaults",
  },
  {
    id: "continue-threads-after-server-update",
    title: msg("Continue threads after restarts"),
    to: "/settings/maintenance",
    scope: "project-defaults",
    searchTerms: [
      "Continue threads after restarts 重启后继续会话",
      msg(
        "resume running active interrupted work restart reboot machine crash desktop update automatically",
      ),
    ],
  },
  {
    id: "keep-awake-while-agents-work",
    title: msg("Keep awake while agents work"),
    to: "/settings/maintenance",
    scope: "environment-defaults",
    searchTerms: [msg("caffeinate sleep prevent stay awake power laptop lid inhibit")],
  },
  {
    id: "background-activity",
    title: msg("Background activity"),
    to: "/settings/maintenance",
    scope: "environment-defaults",
    searchTerms: [
      "Background activity 后台活动",
      msg(
        "balanced performance battery saver advanced git fetch provider health refresh host power monitor idle policy",
      ),
    ],
  },
  {
    id: "new-threads",
    title: msg("New threads"),
    to: "/settings/threads",
    scope: "project-defaults",
    searchTerms: ["New threads 新会话", msg("default workspace mode draft local worktree")],
  },
  {
    id: "worktree-submodules",
    title: msg("Submodules"),
    to: "/settings/worktrees",
    scope: "project-defaults",
    searchTerms: [
      "Submodules 子模块",
      msg("git submodule init recursive top-level none worktree t3.json"),
    ],
  },
  {
    id: "start-from-origin",
    title: msg("Start from remote"),
    to: "/settings/worktrees",
    scope: "project-defaults",
    searchTerms: [
      "Start from origin 从 origin 创建",
      msg("new worktrees start remote origin latest fetched branch local"),
    ],
  },
  {
    id: "add-project-starts-in",
    title: msg("Add project starts in"),
    to: "/settings/threads",
    scope: "environment-defaults",
    searchTerms: [
      "Add project starts in 添加项目的起始目录",
      msg("base directory folder browser path home"),
    ],
  },
  {
    id: "ghq-clone-layout",
    title: msg("Clone into host folders"),
    to: "/settings/threads",
    scope: "environment-defaults",
    searchTerms: [msg("ghq clone destination host owner repository root layout")],
  },
  {
    id: "unpin-confirmation",
    title: msg("Unpin confirmation"),
    to: "/settings/general",
    searchTerms: ["Unpin confirmation 取消置顶确认", msg("ask before thread pinned section")],
  },
  {
    id: "archive-confirmation",
    title: msg("Archive confirmation"),
    to: "/settings/general",
    searchTerms: [
      "Archive confirmation 归档确认",
      msg("ask before thread second click inline action"),
    ],
  },
  {
    id: "delete-confirmation",
    title: msg("Delete confirmation"),
    to: "/settings/general",
    searchTerms: ["Delete confirmation 删除确认", msg("ask before thread chat history")],
  },
  {
    id: "terminal-close-confirmation",
    title: msg("Terminal close confirmation"),
    to: "/settings/general",
    searchTerms: ["ask before delete stop process shell console history"],
  },
  {
    id: "quit-confirmation",
    title: msg("Quit shortcut"),
    to: "/settings/general",
    searchTerms: [
      "Quit shortcut 退出快捷键",
      msg("confirmation desktop app exit direct hold double click press twice"),
    ],
    desktopOnly: true,
  },
  {
    id: "text-generation-model",
    title: msg("Text generation model"),
    to: "/settings/threads",
    scope: "project-defaults",
    searchTerms: [
      "Text generation model 文本生成模型",
      msg("generated thread titles source control content default provider"),
    ],
  },
  {
    id: "thread-title-instructions",
    title: msg("Thread title instructions"),
    to: "/settings/threads",
    scope: "project-defaults",
    searchTerms: [msg("generated thread titles prompt custom style naming rename regenerate")],
  },
  {
    id: "app-version",
    title: msg("Version"),
    to: "/settings/about",
    searchTerms: [msg("about check for updates download install upgrade release")],
  },
  {
    id: "update-track",
    title: msg("Update track"),
    to: "/settings/about",
    searchTerms: [msg("release channel stable latest nightly prerelease")],
    releaseChannelOnly: true,
  },
  {
    id: "cli-command",
    title: msg("t3 command"),
    to: "/settings/about",
    searchTerms: [
      "t3code-convene 命令 cli terminal shell path install command line",
      msg("cli terminal shell path install command line"),
    ],
    desktopOnly: true,
  },
  {
    id: "mobile-app",
    title: msg("Mobile app"),
    to: "/settings/about",
    searchTerms: [
      "移动应用 手机 平板",
      msg("phone tablet iPhone iPad iOS Android App Store Google Play QR"),
    ],
  },
  {
    id: "welcome-page",
    title: msg("Welcome page"),
    to: "/settings/about",
    primaryEnvironmentOnly: true,
    searchTerms: [msg("onboarding setup first run getting started agents import projects")],
  },
  {
    id: "privacy-policy",
    title: msg("Privacy policy"),
    to: "/settings/about",
    searchTerms: ["隐私政策 数据", msg("telemetry analytics usage data tracking legal opt out")],
  },
  {
    id: "telemetry-export",
    title: msg("OpenTelemetry export"),
    to: "/settings/diagnostics",
    targetId: "telemetry-export",
    scope: "environment",
    searchTerms: [msg("OTel OTLP telemetry export endpoints logs traces metrics Grafana")],
  },
  {
    id: "diagnostics",
    title: msg("Diagnostics"),
    to: "/settings/maintenance",
    searchTerms: [
      "Diagnostics 诊断",
      "日志 追踪 进程树 资源历史 失败 跨度 CPU 内存 诊断访问权限",
      "资源监控 资源遥测 主机状态 采集状态 温度 电源 读取吞吐量 写入吞吐量",
      msg("logs traces processes resource history failures spans cpu memory"),
    ],
  },
  {
    id: "open-source-licenses",
    title: msg("Open source licenses"),
    to: "/settings/about",
    searchTerms: ["Open source licenses 开源许可证"],
  },
  {
    id: "keybindings",
    title: msg("Keybindings"),
    to: "/settings/keybindings",
    searchTerms: [
      "Keybindings 快捷键 键盘 按键 动作 默认 自定义 项目",
      msg("keyboard shortcuts hotkeys commands bindings json"),
    ],
  },
  ...KEYBINDING_SEARCH_ITEMS,
  {
    id: "snap-shot-enabled",
    titleKey: "settings.sections.snap-shot",
    title: msg("SnapShots"),
    searchTerms: ["窗口快照 截图 截屏 窗口捕获", msg("window capture screenshot")],
    to: "/settings/snap-shot",
  },
  {
    id: "snap-shot-accessibility",
    titleKey: "snapshots.search.text",
    title: msg("Include app text"),
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
    searchTerms: [
      "Include app text 包含应用文字",
      "应用文字 文本 辅助功能 控件 隐私",
      msg("capture accessibility data text UI structure elements privacy omit agent context"),
    ],
  },
  {
    id: "snap-shot-shortcut",
    titleKey: "snapshots.search.shortcut",
    title: msg("Capture shortcut"),
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
    searchTerms: ["Capture shortcut 快照快捷键", "快照快捷键 快捷键 按键 录制"],
  },
  {
    id: "snap-shot-sound",
    titleKey: "snapshots.search.sound",
    title: msg("Capture sound"),
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
    searchTerms: ["Capture sound 快照声音", "快照声音 音效 风声 快门声 静音"],
  },
  {
    id: "snap-shot-flash",
    titleKey: "snapshots.search.flash",
    title: msg("Capture flash"),
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
    searchTerms: ["Capture flash 快照闪光", "快照闪光 闪烁 提示"],
  },
  {
    id: "snap-shot-animations",
    titleKey: "snapshots.search.animations",
    title: msg("Capture animations"),
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
    searchTerms: ["Capture animations 快照动画", "快照动画 草稿"],
  },
  {
    id: "providers",
    titleKey: "settings.sections.providers",
    title: msg("Providers"),
    to: "/settings/providers",
    searchTerms: [
      "Providers 智能体提供方 agents cli codex claude cursor grok opencode antigravity google sign in sign out install subscription instances authentication api key models configuration binary path config directory endpoint arguments environment variables display name accent color custom favorite hidden auto compact",
      "智能体 提供方 安装 更新 登录 退出 身份验证 实例 模型 环境变量 配置",
      "ACP 注册表 本地命令 实例 ID 强调色 颜色 参数 可执行文件 原生会话 导入",
      msg(
        "agents cli codex claude cursor grok fx kiro opencode antigravity google sign in sign out install subscription instances authentication api key models configuration binary path config directory codex_home shadow home endpoint arguments environment variables display name accent color custom favorite hidden auto compact native sessions import resume",
      ),
    ],
  },
  {
    id: "usage-providers",
    title: msg("Usage providers"),
    to: "/settings/providers",
    searchTerms: [
      "用量来源 用量服务 服务地址 管理密钥 额度 配额 添加服务 移除服务",
      msg(
        "usage sources CLIProxyAPI CLI proxy hub quota subscription limits management key add remove",
      ),
    ],
    providerSettingsOnly: true,
  },
  {
    id: "cursor-keychain-usage",
    title: msg("Cursor Keychain usage"),
    to: "/settings/providers",
    searchTerms: ["cursor macOS keychain usage tokens cost limits permission"],
    providerSettingsOnly: true,
    macProviderSettingsOnly: true,
  },
  {
    id: "text-generators",
    title: msg("Text generators"),
    to: "/settings/providers",
    searchTerms: [
      msg(
        "model api api key openai openrouter anthropic ollama lm studio custom endpoint base url thread titles commit messages",
      ),
    ],
    providerSettingsOnly: true,
    textGeneratorsOnly: true,
  },
  {
    id: "provider-health-check-interval",
    title: msg("Health check interval"),
    to: "/settings/providers",
    searchTerms: [
      "刷新 状态检查 间隔 后台 版本 秒 停用",
      msg("refresh availability versions auth state models background probes seconds off"),
    ],
    providerSettingsOnly: true,
  },
  {
    id: "scheduled-tasks",
    title: msg("Scheduled tasks"),
    to: "/settings/scheduled-tasks",
  },
  {
    id: "agent-browser-access",
    titleKey: "defaults.browser.title",
    title: msg("Agent browser access"),
    to: "/settings/browser",
    scope: "project-defaults",
    searchTerms: [
      "Agent browser access 智能体浏览器访问 浏览器权限 项目覆盖",
      msg("allow disable enable open drive preview tools sessions project override"),
    ],
  },
  {
    id: "device-sources",
    titleKey: "device.sources.title",
    title: msg("Device sources"),
    to: "/settings/devices",
    searchTerms: [
      "设备来源 远程主机 SSH 设备主机",
      msg(
        "device hosts ssh remote mac mini identity key connection eas expo cloud simlock pool gateway local simulators",
      ),
    ],
  },
  {
    id: "agent-device-access",
    titleKey: "device.agent.access",
    title: msg("Agents can use devices"),
    to: "/settings/devices",
    targetId: "devices",
    searchTerms: [
      "Agent device access 智能体设备访问",
      "智能体设备访问 权限 控制 设备工具",
      msg("allow simulator emulator ios android drive tools sessions"),
    ],
  },
  {
    id: "device-hub",
    titleKey: "device.hub.enable",
    title: msg("Use devices"),
    to: "/settings/devices",
    targetId: "devices",
    searchTerms: [
      "设备中心 模拟器 安装 启动",
      msg("device hub simulator emulator ios android install start version"),
    ],
  },
  {
    id: "device-platform-support",
    titleKey: "device.sources.local",
    title: msg("Local simulators"),
    to: "/settings/devices",
    targetId: "device-sources",
    searchTerms: [
      "本地模拟器 模拟器支持",
      msg("simulator support xcode android studio sdk avd runtime"),
    ],
  },
  {
    id: "browser-profiles",
    title: msg("Browser profiles"),
    to: "/settings/browser",
    targetId: "browser",
    searchTerms: [
      "Browser profiles 浏览器配置",
      "profiles cookies logins incognito import clear remove 浏览器配置 Cookie 登录 无痕 导入 清除 移除",
    ],
  },
  {
    id: "browser-default-profile",
    title: msg("Default browser profile"),
    to: "/settings/browser",
    targetId: "browser-profiles",
    searchTerms: [
      "Default browser profile 默认浏览器配置",
      "default browser profile 默认浏览器配置",
    ],
  },
  {
    id: "browser-default-viewport",
    title: msg("Default browser viewport"),
    to: "/settings/browser",
    searchTerms: [
      "Default browser viewport 默认浏览器视口",
      "preview size width height device desktop mobile rotate 视口 尺寸 宽度 高度 设备 旋转 横向 纵向",
      msg("preview size width height device desktop mobile rotate"),
    ],
  },
  {
    id: "browser-default-zoom",
    title: msg("Default browser zoom"),
    to: "/settings/browser",
    searchTerms: [
      "Default browser zoom 默认浏览器缩放",
      "preview page scale tabs percent 浏览器 页面 缩放 比例",
      msg("preview page scale tabs percent"),
    ],
  },
  {
    id: "browser-default-appearance",
    title: msg("Default browser appearance"),
    to: "/settings/browser",
    searchTerms: [
      "Default browser appearance 默认浏览器外观",
      "preview color scheme light dark system os 浏览器 外观 配色 浅色 深色 跟随系统",
      msg("preview color scheme light dark system os"),
    ],
  },
  {
    id: "browser-recording-frame-rate",
    title: msg("Browser recording frame rate"),
    to: "/settings/browser",
    searchTerms: [
      "Browser recording frame rate 浏览器录制帧率",
      "recording frame rate fps browser preview 录制 帧率",
    ],
  },
  {
    id: "browser-recording-key-presses",
    title: msg("Show key presses in recordings"),
    to: "/settings/browser",
    searchTerms: [
      "Show key presses in recordings 在录制中显示按键",
      "browser preview keyboard shortcuts keystrokes overlay capture 浏览器 录制 按键 快捷键",
      msg("browser preview keyboard shortcuts keystrokes overlay capture"),
    ],
  },
  {
    id: "browser-recording-mouse-presses",
    title: msg("Show mouse presses in recordings"),
    to: "/settings/browser",
    searchTerms: [
      "Show mouse presses in recordings 在录制中显示鼠标点击",
      "browser preview clicks buttons drag overlay capture 浏览器 录制 鼠标 点击 拖动",
      msg("browser preview clicks buttons drag overlay capture"),
    ],
  },
  {
    id: "browser-link-target",
    title: msg("Open links in"),
    to: "/settings/browser",
    searchTerms: [
      "Open links in 链接打开位置",
      "links default browser in-app browser external open 链接 打开位置 默认浏览器 应用内浏览器",
      msg("links default browser in-app browser external open"),
    ],
  },
  {
    id: "browser-search-engine",
    title: msg("Search engine"),
    to: "/settings/browser",
    searchTerms: [msg("address bar duckduckgo google bing brave kagi ecosia custom url")],
  },
  {
    id: "pull-request-links-open-in-app",
    title: msg("Open pull requests in T3 Code"),
    to: "/settings/diffs",
    searchTerms: [
      "pr links github browser external click default pull request view panel PR 链接 打开 浏览器 应用内",
      `pr commit links ${SOURCE_CONTROL_HOST_LABELS} browser external click default pull request view panel`,
    ],
  },
  {
    id: "browser-auto-show-floating-preview",
    title: msg("Auto-show floating preview"),
    to: "/settings/browser",
    searchTerms: [
      "Auto-show floating preview 自动显示悬浮预览",
      "agent opens browser device simulator pop into view hide 智能体 浏览器 设备 悬浮预览 自动显示",
      msg("agent opens browser device simulator pop into view hide"),
    ],
  },
  {
    id: "automatic-pull",
    title: msg("Automatically pull"),
    to: "/settings/source-control",
    scope: "project-defaults",
    searchTerms: [msg("auto pull default branch current checkout fast forward upstream")],
  },
  {
    id: "remove-agent-credits-on-merge",
    title: msg("Remove agent credits when merging"),
    to: "/settings/source-control",
    scope: "project-defaults",
    searchTerms: [
      "Remove agent credits when merging 合并时移除智能体署名",
      `pull request ${SOURCE_CONTROL_HOST_LABELS} squash co-authored-by attribution claude codex generated`,
    ],
  },
  {
    id: "pull-request-merge-method",
    title: msg("Default merge method"),
    to: "/settings/source-control",
    scope: "project-defaults",
    searchTerms: [
      "Default merge method 默认合并方式",
      msg("pull request merge squash rebase last selected"),
    ],
  },
  {
    id: "issue-trackers",
    title: msg("Issue trackers"),
    to: "/settings/source-control",
    scope: "environment-defaults",
    searchTerms: [msg("linear jira issues tracker team api key connect bind project")],
  },
  {
    id: "source-control",
    title: msg("Source control"),
    to: "/settings/source-control",
    scope: "environment-defaults",
    searchTerms: [
      "版本控制 代码托管 托管平台 工具发现 安装 凭据 服务器环境 扫描",
      `version control git ${SOURCE_CONTROL_HOST_TERMS} hosting integrations credentials scan server environment`,
    ],
  },
  {
    id: "git-fetch-interval",
    title: msg("Git fetch interval"),
    to: "/settings/maintenance",
    targetId: "background-activity",
    searchTerms: [
      "Git fetch interval Git fetch 间隔",
      "自动获取 后台刷新 远程分支 获取间隔 秒",
      msg("automatic remote branch refresh background credentials security keys seconds off"),
    ],
    environmentOnly: true,
    scope: "environment-defaults",
  },
  {
    id: "worktree-branch-naming",
    title: msg("Worktree branch naming"),
    to: "/settings/worktrees",
    searchTerms: [
      "Git 工作树分支命名 固定前缀 语义前缀 分支前缀 命名指令",
      msg("static semantic prefix custom prompt instructions feat fix refactor chore"),
    ],
    environmentOnly: true,
    scope: "project-defaults",
  },
  ...sourceControlHostSearchItems(sourceControlClients.definitions),
  {
    id: "source-control-writing-style",
    title: msg("Commit and pull request writing"),
    to: "/settings/source-control",
    searchTerms: [
      "版本控制写作风格 仓库惯例 约定式提交 自定义指令 变更说明",
      msg(
        "repository conventions conventional commits custom instructions commit messages change pr pull request merge request titles descriptions body style prompt write my own",
      ),
    ],
    environmentOnly: true,
  },
  {
    id: "follow-change-request-templates",
    title: msg("Follow pull request templates"),
    to: "/settings/source-control",
    searchTerms: [
      "遵循变更请求模板 拉取请求模板 PR 模板",
      msg("repository pr pull request merge request change request description structure"),
    ],
    environmentOnly: true,
  },
  {
    id: "source-control-writer-model",
    title: msg("Source control writer model"),
    to: "/settings/source-control",
    searchTerms: [
      "版本控制写作模型 提交说明 书签命名 分支命名模型",
      msg("override generated commit change request pr titles descriptions branch bookmark"),
    ],
    environmentOnly: true,
    scope: "project-defaults",
  },
  {
    id: "review-guides",
    title: msg("Review guides (beta)"),
    to: "/settings/source-control",
    searchTerms: [msg("pull request pr guided review guide tour beta experimental")],
    environmentOnly: true,
  },
  {
    id: "review-guide-model",
    title: msg("Review guide model"),
    to: "/settings/source-control",
    // Hidden until review guides are on, so a search lands on the switch that shows it.
    targetId: "review-guides",
    searchTerms: [msg("pull request pr guided review guide brief maintainer")],
    environmentOnly: true,
    scope: "project-defaults",
  },
  {
    id: "review-guide-instructions",
    title: msg("Review guide instructions"),
    to: "/settings/source-control",
    targetId: "review-guides",
    searchTerms: [msg("pull request pr guided review guide preferences taste prompt custom")],
    environmentOnly: true,
    scope: "project-defaults",
  },
  {
    id: "project-actions",
    title: msg("Actions"),
    to: "/settings/projects",
    searchTerms: [msg("commands scripts setup run dev server checkout worktree t3.json import")],
  },
  {
    id: "project-repositories",
    title: msg("Repositories"),
    to: "/settings/projects",
    searchTerms: [msg("tracked folders multi repo workspace code-workspace rescan add folder")],
  },
  {
    id: "environment-icon",
    title: msg("Environment icon"),
    to: "/settings/access",
    targetId: "connections-environment",
    searchTerms: [
      "机器 图标 标识",
      msg("machine glyph sidebar mac mini studio laptop desktop server cloud vm"),
    ],
  },
  {
    id: "local-environment",
    title: msg("Local environment"),
    to: "/settings/connections",
    searchTerms: [
      "本机 智能体 开关 服务器 重启",
      msg("turn off on disable enable local server agents remote only restart"),
    ],
    desktopOnly: true,
  },
  {
    id: "network-access",
    title: msg("Network access"),
    to: "/settings/access",
    targetId: "connections-environment",
    searchTerms: [
      "远程 配对 局域网 地址 网络",
      msg("expose backend remote pairing local machine interfaces host restart"),
    ],
    localBackendManagementOnly: true,
  },
  {
    id: "tailscale-https",
    title: msg("Tailscale HTTPS"),
    to: "/settings/access",
    targetId: "connections-environment",
    searchTerms: ["隧道 网络 远程 安全", msg("serve magicdns endpoint remote secure network")],
    desktopOnly: true,
    localBackendManagementOnly: true,
  },
  {
    id: "wsl-backend",
    title: msg("WSL backend"),
    to: "/settings/access",
    searchTerms: [
      "发行版 子系统 后端 重启",
      msg(
        "windows subsystem linux distro second server projects stop windows backend restart wsl only",
      ),
    ],
    desktopOnly: true,
    windowsOnly: true,
    localBackendManagementOnly: true,
    wslAvailableOnly: true,
  },
  {
    id: "t3-connect",
    localEnvironmentOnly: true,
    title: msg("T3 Connect"),
    to: "/settings/access",
    targetId: "connections-environment",
    searchTerms: [
      "隧道 远程 云端 其他设备 中继客户端 安装中继",
      msg("managed tunnel cloud other devices remote tunnels limit t3 chat"),
    ],
    desktopOnly: true,
    cloudOnly: true,
  },
  {
    id: "connect-device-approval",
    title: msg("Require approval for new devices"),
    to: "/settings/access",
    targetId: "connections-environment",
    searchTerms: [
      msg("t3 connect devices approve deny trust revoke pairing code security account"),
    ],
    cloudOnly: true,
    managedTunnelOnly: true,
  },
  {
    id: "hold-webhooks-while-offline",
    localEnvironmentOnly: true,
    title: msg("Hold webhooks while offline"),
    to: "/settings/access",
    targetId: "connections-environment",
    searchTerms: [
      "离线 队列 自动化 暂存",
      msg("webhook automations offline queue mailbox t3 connect"),
    ],
    cloudOnly: true,
    managedTunnelOnly: true,
  },
  {
    id: "publish-agent-activity",
    localEnvironmentOnly: true,
    title: msg("Publish agent activity"),
    to: "/settings/access",
    targetId: "connections-environment",
    searchTerms: [
      "移动 通知 推送 实时活动",
      msg("mobile push notifications live activities cloud tunnel"),
    ],
    cloudOnly: true,
  },
  {
    id: "preview-tunnel",
    title: msg("Preview tunnel"),
    to: "/settings/access",
    targetId: "connections-environment",
    searchTerms: [
      msg("localhost loopback port forwarding open on this device browser tabs stream security"),
    ],
  },
  {
    id: "connections-environment",
    title: msg("This machine"),
    to: "/settings/access",
    searchTerms: [
      "本机 权限 已授权 客户端 配对 凭据 撤销 服务端更新 更新执行环境 重新启动命令",
      msg(
        "connections server backend local remote access administrative permissions scope pairing links qr code authorized clients sessions revoke endpoint",
      ),
    ],
  },
  {
    id: "linked-environments",
    peerLinksOnly: true,
    title: msg("Linked environments"),
    to: "/settings/connections",
    targetId: "linked-environments",
    searchTerms: [msg("link peer another machine vps agents work there handoff pairing code")],
  },
  {
    id: "remote-environments",
    title: msg("Environments"),
    to: "/settings/connections",
    searchTerms: [
      "远程 设备 连接 主机 配对 SSH 路由 服务端更新 更新执行环境 重新启动命令",
      msg("add pair backend host code ssh config agent tunnel saved t3 connect"),
    ],
  },
  {
    id: "load-balancing",
    title: msg("Load balancing"),
    to: "/settings/connections",
    searchTerms: [
      "分配 负载 多设备 CPU 内存",
      msg(
        "automatic machine environment resources cpu memory capacity preference weight shared projects",
      ),
    ],
  },
  {
    id: "pull-request-routing",
    title: msg("Pull request sharing"),
    to: "/settings/connections",
    searchTerms: [
      `pull request routing trusted environments shared credentials permissions read actions source control ${SOURCE_CONTROL_HOST_LABELS}`,
    ],
  },
  {
    id: "secret-providers",
    title: msg("Secret providers"),
    to: "/settings/secrets",
    searchTerms: [msg("1password vault credentials api key")],
    secretProvidersOnly: true,
  },
  {
    id: "secret-providers-add",
    title: msg("Add secret provider"),
    to: "/settings/secrets",
    targetId: "secret-providers",
    searchTerms: [msg("new 1password vault op cli account")],
    secretProvidersOnly: true,
  },
  {
    id: "archive",
    title: msg("Archived threads"),
    to: "/settings/archived",
    searchTerms: [msg("restore reopen deleted history projects")],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;

export type SettingsSearchItemId = (typeof SETTINGS_SEARCH_ITEMS)[number]["id"];

const SEARCH_ITEMS_BY_ID = new Map(SETTINGS_SEARCH_ITEMS.map((item) => [item.id, item] as const));

const SETTINGS_CATEGORY_SCOPES: Readonly<Record<SettingsPath, SettingsSearchScope | null>> = {
  "/settings/convene": "environment",
  "/settings/diagnostics": "environment",
  "/settings/projects": "project",
  "/settings/general": null,
  "/settings/voice": null,
  "/settings/appearance": null,
  "/settings/chat": null,
  "/settings/diffs": null,
  "/settings/snap-shot": null,
  "/settings/keybindings": null,
  "/settings/providers": null,
  "/settings/threads": null,
  "/settings/browser": null,
  "/settings/devices": null,
  "/settings/source-control": "environment-defaults",
  "/settings/worktrees": "project-defaults",
  "/settings/connections": "connections",
  "/settings/access": "connections",
  "/settings/secrets": null,
  "/settings/scheduled-tasks": null,
  "/settings/maintenance": null,
  "/settings/labs": null,
  "/settings/about": null,
  "/settings/archived": "project-defaults",
};

const RENAMED_SETTINGS_PATHS: Readonly<Record<string, SettingsPath>> = {
  "/settings/integrations": "/settings/browser",
  "/settings/storage": "/settings/maintenance",
  "/settings/beta": "/settings/labs",
};
const SPLIT_SETTINGS_PATHS: ReadonlySet<string> = new Set([
  "/settings/general",
  "/settings/appearance",
  "/settings/source-control",
  "/settings/connections",
  ...Object.keys(RENAMED_SETTINGS_PATHS),
]);
// Section anchors that moved but are not search results themselves.
const MOVED_SECTION_ANCHORS: Readonly<Record<string, SettingsPath>> = {
  "authorized-clients": "/settings/access",
  "text-generation": "/settings/threads",
  about: "/settings/about",
};

/** Where an old settings link now lives. Its anchor finds the page its row moved to. */
export function movedSettingsPath(pathname: string, hash: string): SettingsPath | null {
  if (!SPLIT_SETTINGS_PATHS.has(pathname)) return null;
  const items: readonly SettingsSearchItem[] = SETTINGS_SEARCH_ITEMS;
  const anchored = hash
    ? (items.find((item) => item.id === hash) ?? items.find((item) => item.targetId === hash))
    : undefined;
  const to =
    anchored?.to ?? MOVED_SECTION_ANCHORS[hash] ?? RENAMED_SETTINGS_PATHS[pathname] ?? null;
  return to === pathname ? null : to;
}

export function getSettingsSearchTargetScope(targetId: string) {
  const items: readonly SettingsSearchItem[] = SETTINGS_SEARCH_ITEMS;
  const item =
    items.find((candidate) => candidate.id === targetId) ??
    items.find((candidate) => candidate.targetId === targetId);
  return item
    ? {
        title: item.title,
        scope: item.scope ?? SETTINGS_CATEGORY_SCOPES[item.to],
        ...(item.requiresThreadAutoSettlement ? { requiresThreadAutoSettlement: true } : {}),
      }
    : null;
}

interface AutoSettlementSearchEnvironment {
  readonly environmentId: EnvironmentId;
  readonly connection: { readonly phase: EnvironmentConnectionPhase };
  readonly serverConfig: object | null;
}

export function getThreadAutoSettlementSearchAvailability(
  environments: readonly AutoSettlementSearchEnvironment[],
  scope?: Pick<ResolvedSettingsScope, "kind" | "environmentIds">,
) {
  const connected = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" && environment.serverConfig !== null,
  );
  const eligibleEnvironmentIds = connected.map((environment) => environment.environmentId);
  const selected = connected.filter((environment) =>
    scope?.environmentIds.includes(environment.environmentId),
  );
  return {
    eligibleEnvironmentIds,
    isTargetAvailable:
      scope !== undefined &&
      scope.kind !== "unavailable" &&
      selected.length > 0 &&
      selected.every((environment) => eligibleEnvironmentIds.includes(environment.environmentId)),
  };
}

export function isSettingsSearchScopeAvailable(
  requiredScope: SettingsSearchScope | null,
  scopeKind: ResolvedSettingsScope["kind"],
): boolean {
  switch (requiredScope) {
    case null:
    case "connections":
      return true;
    case "environment":
    case "checkout":
      return requiredScope === scopeKind;
    case "project":
      return scopeKind === "project" || scopeKind === "checkout";
    case "environment-defaults":
      return scopeKind === "environment" || scopeKind === "all";
    case "project-defaults":
      return (
        scopeKind === "environment" ||
        scopeKind === "all" ||
        scopeKind === "project" ||
        scopeKind === "checkout"
      );
  }
}

export function settingsSectionLabel(to: SettingsPath, translate: TFunction = i18n.t): string {
  const key =
    to === "/settings/diagnostics"
      ? "settings.search.diagnostics.title"
      : `settings.sections.${to.split("/").at(-1)}`;
  return translate(key, {
    defaultValue: m(SETTINGS_SECTION_LABELS[to]),
  });
}

function localizedSettingsTitle(
  item: Pick<SettingsSearchItem, "id" | "title" | "titleKey">,
  translate: TFunction,
  resolve: MessageResolver,
): string {
  const key = item.titleKey ?? `settings.search.${item.id}.title`;
  return translate(key, { defaultValue: resolve(item.title) });
}

export function searchableSetting(
  id: SettingsSearchItemId,
  translate: TFunction = i18n.t,
): {
  readonly id: string;
  readonly title: string;
} {
  const item = SEARCH_ITEMS_BY_ID.get(id)!;
  return {
    id: item.id,
    title: localizedSettingsTitle(item, translate, m),
  };
}

/** `searchableSetting` with its title in the active language, for spreading onto a row. */
export function useSearchableSetting() {
  const translate = useTranslate();
  const resolve = useMessages();
  return (id: SettingsSearchItemId, translateOverride: TFunction = translate) => {
    const item = SEARCH_ITEMS_BY_ID.get(id)!;
    return {
      id: item.id,
      title: localizedSettingsTitle(item, translateOverride, resolve),
    };
  };
}

export function filterAvailableSettingsSearchItems(
  availability: SettingsSearchAvailability,
): ReadonlyArray<SettingsSearchItem> {
  const items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS;
  return items.filter(
    (item) =>
      (!item.cloudOnly || availability.hasCloudPublicConfig) &&
      (!item.environmentOnly || availability.hasEnvironment) &&
      (!item.providerSettingsOnly || availability.hasProviderSettingsEnvironment) &&
      (!item.macProviderSettingsOnly || availability.hasMacProviderSettingsEnvironment) &&
      (!item.localBackendManagementOnly || availability.canManageLocalBackend) &&
      (!item.localEnvironmentOnly || !availability.localEnvironmentDisabled) &&
      (!item.primaryEnvironmentOnly || availability.hasPrimaryEnvironment === true) &&
      (!item.wslAvailableOnly || availability.isWslSettingsRowVisible) &&
      (!item.requiresThreadAutoSettlement || availability.hasThreadAutoSettlement) &&
      (!item.managedTunnelOnly || availability.managedTunnelActive === true) &&
      (!item.peerLinksOnly || availability.hasPeerLinkHost === true) &&
      (!item.fastWorktreeCheckoutOnly ||
        availability.hasFastWorktreeCheckoutEnvironment === true) &&
      (!item.textGeneratorsOnly || availability.hasTextGeneratorsEnvironment === true) &&
      (!item.secretProvidersOnly || availability.hasSecretProvidersEnvironment === true),
  );
}

/** The settings that exist on this platform and app channel. */
export function settingsForThisPlatform(
  items: ReadonlyArray<SettingsSearchItem>,
): ReadonlyArray<SettingsSearchItem> {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  return items.filter(
    (item) =>
      (isElectron || item.desktopOnly !== true) &&
      (!item.releaseChannelOnly || isElectron || HOSTED_APP_CHANNEL !== null) &&
      (!item.macOnly || isMacPlatform(platform)) &&
      (!item.windowsOnly || isWindowsPlatform(platform)),
  );
}

export function searchSettings(
  query: string,
  items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS,
  resolve: MessageResolver = m,
  translate: TFunction = i18n.t,
): ReadonlyArray<SettingsSearchItem> {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return [];
  const queryTokens = normalizedQuery.split(" ");

  return settingsForThisPlatform(items)
    .flatMap((item, index) => {
      const label = localizedSettingsTitle(item, translate, resolve);
      const title = normalizeSearchText(label);
      const sourceTitle = normalizeSearchText(decodeMsg(item.title));
      const section = SETTINGS_SECTION_LABELS[item.to];
      const fields = [
        title,
        sourceTitle,
        normalizeSearchText(settingsSectionLabel(item.to, translate)),
        normalizeSearchText(decodeMsg(section)),
        normalizeSearchText(resolve(section)),
        ...(item.searchTerms ?? []).map((term) => normalizeSearchText(decodeMsg(term))),
        ...(item.searchTerms ?? []).map((term) => normalizeSearchText(resolve(term))),
      ];
      if (!queryTokens.every((token) => fields.some((field) => field.includes(token)))) return [];

      const exactPhraseField = fields.findIndex((field) => field.includes(normalizedQuery));
      const rank =
        title === normalizedQuery
          ? 5
          : title.startsWith(normalizedQuery)
            ? 4
            : title.includes(normalizedQuery)
              ? 3
              : queryTokens.every((token) => title.includes(token))
                ? 2
                : exactPhraseField >= 0
                  ? 1
                  : 0;
      return [{ item: { ...item, title: label }, index, rank }];
    })
    .toSorted(
      (left, right) =>
        Number(left.item.secondary ?? false) - Number(right.item.secondary ?? false) ||
        right.rank - left.rank ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}

// These rows only exist with separate fonts on, so a search jump to one turns them on.
const ADVANCED_TYPOGRAPHY_TARGET_IDS: ReadonlySet<string> = new Set([
  "prompt-font",
  "terminal-font",
]);

export function isAdvancedTypographyTarget(targetId: string): boolean {
  return ADVANCED_TYPOGRAPHY_TARGET_IDS.has(targetId);
}

/**
 * Opens the persisted section a search result lives in before jumping to it, so
 * its row is mounted to scroll to. The terminal reads the same flag, so it must
 * stay on after the jump.
 */
export function revealSettingsSearchTarget(targetId: string): void {
  if (isAdvancedTypographyTarget(targetId)) {
    writeLocalStorageValue(TYPOGRAPHY_ADVANCED_STORAGE_KEY, true, false, Schema.Boolean);
  }
}
