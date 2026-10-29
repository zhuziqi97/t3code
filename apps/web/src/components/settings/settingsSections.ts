import {
  ArchiveIcon,
  BotIcon,
  CalendarClockIcon,
  createLucideIcon,
  FileDiffIcon,
  FlaskConicalIcon,
  FolderTreeIcon,
  GitBranchIcon,
  GlobeIcon,
  InfoIcon,
  KeyboardIcon,
  Link2Icon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
  PaletteIcon,
  PanelsTopLeftIcon,
  ServerIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SmartphoneIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

export type SettingsSearchScope =
  | "environment"
  | "environment-defaults"
  | "project-defaults"
  | "project"
  | "checkout"
  | "connections";

const SnapShotIcon = createLucideIcon("snap-shot", [
  [
    "path",
    {
      d: "M8 3H6a3 3 0 0 0-3 3v2M16 3h2a3 3 0 0 1 3 3v2M21 16v2a3 3 0 0 1-3 3h-2M8 21H6a3 3 0 0 1-3-3v-2",
      key: "capture-frame",
    },
  ],
  ["rect", { width: "10", height: "8", x: "7", y: "8", rx: "2", key: "window" }],
  ["circle", { cx: "12", cy: "12", r: "1.5", key: "lens" }],
]);

const NAV_GROUPS = [
  { id: "general", headingKey: null, heading: null },
  { id: "agents", headingKey: "settings.groups.agents", heading: "Agents" },
  { id: "code", headingKey: "settings.groups.code", heading: "Code" },
  { id: "connections", headingKey: "settings.sections.connections", heading: "Connections" },
  { id: "other", headingKey: null, heading: null },
] as const;

interface SettingsSectionDefinition {
  readonly path: `/settings/${string}`;
  readonly labelKey: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly group: (typeof NAV_GROUPS)[number]["id"] | null;
  readonly searchScope?: SettingsSearchScope;
  readonly search?: ReadonlyArray<{
    readonly id: string;
    readonly titleKey: string;
    readonly searchTerms: ReadonlyArray<string>;
  }>;
}

export const SETTINGS_SECTIONS = [
  {
    path: "/settings/general",
    labelKey: "settings.sections.general",
    label: "General",
    icon: Settings2Icon,
    group: "general",
  },
  {
    path: "/settings/appearance",
    labelKey: "settings.sections.appearance",
    label: "Appearance",
    icon: PaletteIcon,
    group: "general",
  },
  {
    path: "/settings/chat",
    labelKey: "settings.sections.chat",
    label: "Chat",
    icon: MessageSquareTextIcon,
    group: "general",
  },
  {
    path: "/settings/diffs",
    labelKey: "settings.sections.diffs",
    label: "Diffs & pull requests",
    icon: FileDiffIcon,
    group: "general",
  },
  {
    path: "/settings/keybindings",
    labelKey: "settings.sections.keybindings",
    label: "Keybindings",
    icon: KeyboardIcon,
    group: "general",
  },
  {
    path: "/settings/snap-shot",
    labelKey: "settings.sections.snap-shot",
    label: "SnapShots",
    icon: SnapShotIcon,
    group: "general",
  },
  {
    path: "/settings/providers",
    labelKey: "settings.sections.providers",
    label: "Providers",
    icon: BotIcon,
    group: "agents",
  },
  {
    path: "/settings/threads",
    labelKey: "settings.sections.threads",
    label: "Threads",
    icon: MessagesSquareIcon,
    group: "agents",
  },
  {
    path: "/settings/browser",
    labelKey: "settings.sections.browser",
    label: "Browser",
    icon: GlobeIcon,
    group: "agents",
  },
  {
    path: "/settings/devices",
    labelKey: "settings.sections.devices",
    label: "Devices",
    icon: SmartphoneIcon,
    group: "agents",
  },
  {
    path: "/settings/scheduled-tasks",
    labelKey: "settings.sections.scheduled-tasks",
    label: "Scheduled tasks",
    icon: CalendarClockIcon,
    group: "agents",
  },
  {
    path: "/settings/projects",
    labelKey: "settings.sections.projects",
    label: "Projects",
    icon: PanelsTopLeftIcon,
    group: "code",
    searchScope: "project",
  },
  {
    path: "/settings/source-control",
    labelKey: "settings.sections.source-control",
    label: "Source control",
    icon: GitBranchIcon,
    group: "code",
    searchScope: "environment-defaults",
  },
  {
    path: "/settings/worktrees",
    labelKey: "settings.sections.worktrees",
    label: "Worktrees",
    icon: FolderTreeIcon,
    group: "code",
    searchScope: "project-defaults",
  },
  {
    path: "/settings/connections",
    labelKey: "settings.sections.connections",
    label: "Environments",
    icon: ServerIcon,
    group: "connections",
    searchScope: "connections",
  },
  {
    path: "/settings/convene",
    labelKey: "settings.sections.convene",
    label: "Convene",
    icon: Link2Icon,
    group: "connections",
    search: [
      {
        id: "convene-connection",
        titleKey: "convene.connection.connect",
        searchTerms: [
          "convene pairing modules MCP client activation",
          "连接 配对 模块 客户端 激活",
        ],
      },
    ],
  },
  {
    path: "/settings/access",
    labelKey: "settings.sections.access",
    label: "Sharing & access",
    icon: ShieldCheckIcon,
    group: "connections",
    searchScope: "connections",
  },
  {
    path: "/settings/maintenance",
    labelKey: "settings.sections.maintenance",
    label: "Maintenance",
    icon: WrenchIcon,
    group: "other",
  },
  {
    path: "/settings/labs",
    labelKey: "settings.sections.labs",
    label: "Labs",
    icon: FlaskConicalIcon,
    group: "other",
  },
  {
    path: "/settings/about",
    labelKey: "settings.sections.about",
    label: "About",
    icon: InfoIcon,
    group: "other",
  },
  {
    path: "/settings/archived",
    labelKey: "settings.sections.archived",
    label: "Archive",
    icon: ArchiveIcon,
    group: "other",
    searchScope: "project-defaults",
  },
  {
    path: "/settings/diagnostics",
    labelKey: "settings.search.diagnostics.title",
    label: "Diagnostics",
    icon: WrenchIcon,
    group: null,
    searchScope: "environment",
  },
] as const satisfies ReadonlyArray<SettingsSectionDefinition>;

export type SettingsPath = (typeof SETTINGS_SECTIONS)[number]["path"];

export const SETTINGS_SECTIONS_BY_PATH: ReadonlyMap<SettingsPath, SettingsSectionDefinition> =
  new Map(SETTINGS_SECTIONS.map((section) => [section.path, section]));

export const SETTINGS_NAV_GROUPS = NAV_GROUPS.map((group) => ({
  ...group,
  sections: SETTINGS_SECTIONS.filter((section) => section.group === group.id),
}));
