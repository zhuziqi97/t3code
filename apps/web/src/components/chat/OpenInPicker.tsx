import { useTranslate } from "../../i18n";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { EditorId, type EnvironmentId, type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { memo, useRef } from "react";
import { shortcutLabelForCommand } from "../../keybindings";
import {
  usePreferredEditor,
  useEditorAction,
  type ClientEditorId,
  type EditorWorkspace,
} from "../../editorPreferences";
import { editorLabelForPlatform } from "../../editorLabels";
import { ChevronDownIcon, FolderClosedIcon, SquareArrowOutUpRightIcon } from "lucide-react";

import { Group, GroupSeparator } from "../ui/group";
import {
  Menu,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuShortcut,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
  MenuTrigger,
} from "../ui/menu";
import {
  AntigravityIcon,
  CursorIcon,
  FileExplorerIcon,
  FinderIcon,
  Icon,
  KiroIcon,
  TraeIcon,
  VisualStudioCode,
  VisualStudioCodeInsiders,
  VSCodium,
  Zed,
} from "../Icons";
import {
  AquaIcon,
  CLionIcon,
  DataGripIcon,
  DataSpellIcon,
  GoLandIcon,
  IntelliJIdeaIcon,
  PhpStormIcon,
  PyCharmIcon,
  RiderIcon,
  RubyMineIcon,
  RustRoverIcon,
  WebStormIcon,
} from "../JetBrainsIcons";
import { cn, isMacPlatform, isWindowsPlatform } from "~/lib/utils";
import {
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "./threadDetailsPanelStyles";
import { useOpenFavoriteEditorShortcut } from "./OpenInPickerShortcut";
import { toastManager } from "../ui/toast";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useComposerMenuState } from "./useComposerMenuState";

type OpenInOption = {
  label: string;
  Icon: Icon;
  value: ClientEditorId;
  kind: "brand" | "generic";
};

const resolveOpenInOptions = (platform: string, availableEditors: ReadonlyArray<EditorId>) => {
  const baseOptions: ReadonlyArray<Omit<OpenInOption, "label" | "value"> & { value: EditorId }> = [
    {
      Icon: CursorIcon,
      value: "cursor",
      kind: "brand",
    },
    {
      Icon: TraeIcon,
      value: "trae",
      kind: "brand",
    },
    {
      Icon: KiroIcon,
      value: "kiro",
      kind: "brand",
    },
    {
      Icon: VisualStudioCode,
      value: "vscode",
      kind: "brand",
    },
    {
      Icon: VisualStudioCodeInsiders,
      value: "vscode-insiders",
      kind: "brand",
    },
    {
      Icon: VSCodium,
      value: "vscodium",
      kind: "brand",
    },
    {
      Icon: Zed,
      value: "zed",
      kind: "brand",
    },
    {
      Icon: AntigravityIcon,
      value: "antigravity",
      kind: "brand",
    },
    {
      Icon: IntelliJIdeaIcon,
      value: "idea",
      kind: "brand",
    },
    {
      Icon: AquaIcon,
      value: "aqua",
      kind: "brand",
    },
    {
      Icon: CLionIcon,
      value: "clion",
      kind: "brand",
    },
    {
      Icon: DataGripIcon,
      value: "datagrip",
      kind: "brand",
    },
    {
      Icon: DataSpellIcon,
      value: "dataspell",
      kind: "brand",
    },
    {
      Icon: GoLandIcon,
      value: "goland",
      kind: "brand",
    },
    {
      Icon: PhpStormIcon,
      value: "phpstorm",
      kind: "brand",
    },
    {
      Icon: PyCharmIcon,
      value: "pycharm",
      kind: "brand",
    },
    {
      Icon: RiderIcon,
      value: "rider",
      kind: "brand",
    },
    {
      Icon: RubyMineIcon,
      value: "rubymine",
      kind: "brand",
    },
    {
      Icon: RustRoverIcon,
      value: "rustrover",
      kind: "brand",
    },
    {
      Icon: WebStormIcon,
      value: "webstorm",
      kind: "brand",
    },
    {
      Icon: isMacPlatform(platform)
        ? FinderIcon
        : isWindowsPlatform(platform)
          ? FileExplorerIcon
          : FolderClosedIcon,
      value: "file-manager",
      kind: isMacPlatform(platform) || isWindowsPlatform(platform) ? "brand" : "generic",
    },
  ];
  const availableEditorSet = new Set(availableEditors);
  return baseOptions
    .filter((option) => availableEditorSet.has(option.value))
    .map((option) => ({ ...option, label: editorLabelForPlatform(option.value, platform) }));
};

function getOpenInIconClass(kind: OpenInOption["kind"]) {
  return cn(kind === "brand" ? "text-foreground opacity-100" : "text-muted-foreground");
}

export const OpenInPicker = memo(function OpenInPicker({
  environmentId,
  keybindings,
  availableEditors,
  openInCwd,
  openInCwdIsFile = false,
  presentation = "toolbar",
  compact = false,
  enableShortcut = true,
  displayMode = "toolbar",
  revealFileManager = false,
  workspace,
}: {
  environmentId: EnvironmentId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
  openInCwdIsFile?: boolean;
  presentation?: "toolbar" | "menu";
  compact?: boolean;
  enableShortcut?: boolean;
  displayMode?: "toolbar" | "panel";
  revealFileManager?: boolean;
  workspace?: EditorWorkspace | undefined;
}) {
  const t = useTranslate();
  const isPanel = displayMode === "panel";
  const ActionGroup = isPanel ? "div" : Group;
  const panelAnchorRef = useRef<HTMLDivElement | null>(null);
  const action = useEditorAction(environmentId, availableEditors, workspace);
  const [preferredEditor, setPreferredEditor] = usePreferredEditor();
  const [menuOpen, setMenuOpen] = useComposerMenuState(false);
  const openInEditor = async (editor: ClientEditorId = preferredEditor) => {
    if (!openInCwd) return;
    const result = await action.open(openInCwd, {
      editor,
      isFile: openInCwdIsFile,
      ...(revealFileManager && editor === "file-manager" ? { reveal: true } : {}),
    });
    if (result._tag === "Failure")
      toastManager.add({
        type: "error",
        title: t("chat.editor.open"),
        description: String(squashAtomCommandFailure(result)),
      });
  };
  useOpenFavoriteEditorShortcut({
    enabled: enableShortcut,
    environmentId,
    keybindings,
    availableEditors,
    openInCwd,
    workspace,
    isFile: openInCwdIsFile,
  });
  const openFavoriteEditorShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "editor.openFavorite",
  );
  const options: OpenInOption[] = [
    {
      label: t("chat.editor.browser"),
      Icon: SquareArrowOutUpRightIcon,
      value: "browser",
      kind: "generic",
    },
    ...resolveOpenInOptions(navigator.platform, action.editorIds),
  ];
  const primaryOption = options.find(({ value }) => value === preferredEditor) ?? null;
  const primaryLabel = t("chat.editor.open");
  const unavailableReason = action.unavailableReason(preferredEditor);

  const editorItems = (
    <>
      {options.map(({ label, Icon, value, kind }) => {
        const reason = action.unavailableReason(value);
        return (
          <MenuItem
            density={presentation === "menu" ? "touch" : "default"}
            disabled={!openInCwd || reason !== null}
            title={reason ?? undefined}
            key={value}
            onClick={() => {
              setPreferredEditor(value);
              if (presentation === "menu") void openInEditor(value);
            }}
          >
            <Icon aria-hidden="true" className={getOpenInIconClass(kind)} />
            <MenuItemLabel>
              {label}
              {reason ? ` — ${reason}` : ""}
            </MenuItemLabel>
            {value === preferredEditor && openFavoriteEditorShortcutLabel && (
              <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
            )}
          </MenuItem>
        );
      })}
    </>
  );
  if (presentation === "menu") {
    return (
      <>
        <MenuItem
          density="touch"
          title={unavailableReason ?? primaryOption?.label}
          disabled={!openInCwd || unavailableReason !== null}
          onClick={() => openInEditor(preferredEditor)}
        >
          <SquareArrowOutUpRightIcon className="size-4" />
          <MenuItemLabel>{primaryLabel}</MenuItemLabel>
          {openFavoriteEditorShortcutLabel && (
            <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
          )}
        </MenuItem>
        <MenuSub>
          <MenuSubTrigger density="touch">
            <SquareArrowOutUpRightIcon className="size-4" />
            <MenuItemLabel>{t("chat.editor.choose")}</MenuItemLabel>
          </MenuSubTrigger>
          <MenuSubPopup>{editorItems}</MenuSubPopup>
        </MenuSub>
      </>
    );
  }

  return (
    <ActionGroup
      aria-label={t("chat.editor.open")}
      role="group"
      {...(isPanel
        ? { className: THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS, ref: panelAnchorRef }
        : {})}
    >
      <ThreadDetailsControl
        aria-label={compact ? t("chat.editor.preferred") : primaryLabel}
        size={isPanel ? "sm" : "xs"}
        variant={isPanel ? "ghost" : "outline"}
        part="primary"
        panel={isPanel}
        disabled={!openInCwd || unavailableReason !== null}
        title={unavailableReason ?? primaryOption?.label}
        onClick={() => openInEditor(preferredEditor)}
      >
        {primaryOption?.Icon ? (
          <primaryOption.Icon
            aria-hidden="true"
            className={cn(
              isPanel ? THREAD_DETAILS_PANEL_ICON_CLASS : "size-3.5",
              getOpenInIconClass(primaryOption.kind),
            )}
          />
        ) : isPanel ? (
          <SquareArrowOutUpRightIcon
            aria-hidden="true"
            className={THREAD_DETAILS_PANEL_ICON_CLASS}
          />
        ) : null}
        <span
          className={cn(
            compact
              ? "sr-only"
              : "sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5",
            isPanel && cn("not-sr-only ml-0 min-w-0 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS),
          )}
        >
          {primaryLabel}
        </span>
      </ThreadDetailsControl>
      {isPanel ? (
        <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
      ) : (
        <GroupSeparator {...(!compact ? { className: "hidden @3xl/header-actions:block" } : {})} />
      )}
      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
        <MenuTrigger
          render={
            <ThreadDetailsControl
              aria-label={t("chat.editor.choose")}
              size={isPanel ? "sm" : "icon-xs"}
              variant={isPanel ? "ghost" : "outline"}
              part="secondary"
              panel={isPanel}
            />
          }
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={isPanel ? THREAD_DETAILS_PANEL_CHEVRON_CLASS : "size-4"}
          />
        </MenuTrigger>
        <MenuPopup
          align="end"
          {...(isPanel ? { anchor: panelAnchorRef } : {})}
          className={isPanel ? "w-(--anchor-width)" : undefined}
        >
          {editorItems}
        </MenuPopup>
      </Menu>
    </ActionGroup>
  );
});
