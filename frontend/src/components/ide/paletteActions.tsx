import {
  Brain,
  Bug,
  Columns2,
  FileCode2,
  FlaskConical,
  FolderOpen,
  GitBranch,
  Keyboard,
  KeyRound,
  ListTree,
  Maximize2,
  PanelLeft,
  PanelRight,
  Puzzle,
  RotateCcw,
  Rows2,
  Save,
  Search,
  Settings2,
  SquareTerminal,
  X,
} from "lucide-react";
import { activeGroupIdOf, type LayoutState } from "@/lib/layout";
import type { EditorTab } from "./EditorGroups";
import type { PaletteAction } from "@/components/editor/paletteTypes";

const SOURCE = "Goland";

export function buildPaletteActions({
  activePath,
  cursorLine,
  layout,
  tabs,
  compact,
  saveTab,
  closeTab,
  toggleSidebar,
  toggleSidebarPosition,
  toggleBottom,
  openBottom,
  showSideView,
  openPalette,
  openManagers,
  openSettings,
  openTokens,
  openByok,
  goToWorkspaceSymbol,
  goToDefinition,
  findReferences,
  goToImplementation,
  renameSymbol,
  toggleBreakpoint,
  split,
  closeEditorGroup,
  setBottomMaximized,
  reset,
  pluginActions,
}: {
  activePath: string;
  cursorLine: number;
  layout: LayoutState;
  tabs: EditorTab[];
  compact: boolean;
  saveTab: (path: string) => void;
  closeTab: (path: string) => void;
  toggleSidebar: () => void;
  toggleSidebarPosition: () => void;
  toggleBottom: () => void;
  openBottom: (view: "tests") => void;
  showSideView: (view: "outline" | "explorer" | "git" | "debug" | "search") => void;
  openPalette: () => void;
  openManagers: () => void;
  openSettings: () => void;
  openTokens: () => void;
  openByok: () => void;
  goToWorkspaceSymbol: () => void;
  goToDefinition: () => void;
  findReferences: () => void;
  goToImplementation: () => void;
  renameSymbol: () => void;
  toggleBreakpoint: (path: string, line: number) => void;
  split: (direction: "right" | "down") => void;
  closeEditorGroup: (groupId: string) => void;
  setBottomMaximized: (maximized: boolean) => void;
  reset: (paths: string[], activePath?: string) => void;
  pluginActions: PaletteAction[];
}): PaletteAction[] {
  return [
    {
      id: "save",
      label: "Save active file",
      description: "Write the current editor buffer to disk.",
      category: "Editor",
      source: SOURCE,
      defaultKey: "Mod+S",
      icon: <Save className="h-3.5 w-3.5" />,
      run: () => activePath && void saveTab(activePath),
    },
    {
      id: "close-tab",
      label: "Close active file",
      description: "Close the current editor tab.",
      category: "Editor",
      source: SOURCE,
      icon: <X className="h-3.5 w-3.5" />,
      run: () => activePath && closeTab(activePath),
    },
    {
      id: "command-palette",
      label: "Show command palette",
      description: "Search commands and files.",
      category: "Navigation",
      source: SOURCE,
      defaultKey: "Mod+K",
      icon: <Keyboard className="h-3.5 w-3.5" />,
      run: openPalette,
    },
    {
      id: "open-managers",
      label: "Open command center",
      description: "Manage commands, menus and keyboard shortcuts.",
      category: "Configuration",
      source: SOURCE,
      defaultKey: "Mod+Alt+K",
      icon: <Settings2 className="h-3.5 w-3.5" />,
      run: openManagers,
    },
    {
      id: "toggle-terminal",
      label: "Toggle terminal",
      description: "Show or hide the bottom panel.",
      category: "Layout",
      source: SOURCE,
      defaultKey: "Mod+`",
      icon: <SquareTerminal className="h-3.5 w-3.5" />,
      run: toggleBottom,
    },
    {
      id: "toggle-sidebar",
      label: "Toggle sidebar",
      description: "Show or hide the activity sidebar.",
      category: "Layout",
      source: SOURCE,
      defaultKey: "Mod+B",
      icon: <FolderOpen className="h-3.5 w-3.5" />,
      run: toggleSidebar,
    },
    {
      id: "toggle-sidebar-position",
      label: layout.sidebarPosition === "right" ? "Move sidebar to left" : "Move sidebar to right",
      description: "Dock the activity bar and sidebar on the other side.",
      category: "Layout",
      source: SOURCE,
      icon: layout.sidebarPosition === "right" ? <PanelLeft className="h-3.5 w-3.5" /> : <PanelRight className="h-3.5 w-3.5" />,
      run: toggleSidebarPosition,
    },
    {
      id: "show-tests",
      label: "Show tests",
      description: "Open the test explorer.",
      category: "Test",
      source: SOURCE,
      defaultKey: "Mod+Shift+T",
      icon: <FlaskConical className="h-3.5 w-3.5" />,
      run: () => openBottom("tests"),
    },
    {
      id: "show-outline",
      label: "Show outline",
      description: "Open the symbol outline.",
      category: "Navigation",
      source: SOURCE,
      defaultKey: "Mod+Shift+O",
      icon: <ListTree className="h-3.5 w-3.5" />,
      run: () => showSideView("outline"),
    },
    {
      id: "show-explorer",
      label: "Show explorer",
      description: "Open the file explorer.",
      category: "Navigation",
      source: SOURCE,
      defaultKey: "Mod+Shift+E",
      icon: <FolderOpen className="h-3.5 w-3.5" />,
      run: () => showSideView("explorer"),
    },
    {
      id: "show-search",
      label: "Show search",
      description: "Search file contents across the workspace.",
      category: "Navigation",
      source: SOURCE,
      defaultKey: "Mod+Shift+F",
      icon: <Search className="h-3.5 w-3.5" />,
      run: () => showSideView("search"),
    },
    {
      id: "show-git",
      label: "Show source control",
      description: "Open the Git panel.",
      category: "Navigation",
      source: SOURCE,
      defaultKey: "Mod+Shift+G",
      icon: <GitBranch className="h-3.5 w-3.5" />,
      run: () => showSideView("git"),
    },
    {
      id: "show-debug",
      label: "Start debugging",
      description: "Open the run and debug panel.",
      category: "Debug",
      source: SOURCE,
      defaultKey: "F5",
      icon: <Bug className="h-3.5 w-3.5" />,
      run: () => showSideView("debug"),
    },
    {
      id: "workspace-symbol",
      label: "Go to symbol in workspace…",
      description: "Search symbols provided by the active language server.",
      category: "Navigate",
      source: SOURCE,
      defaultKey: "Mod+T",
      icon: <Search className="h-3.5 w-3.5" />,
      run: () => void goToWorkspaceSymbol(),
    },
    {
      id: "go-to-definition",
      label: "Go to definition",
      description: "Jump to the symbol definition under the cursor.",
      category: "Code",
      source: SOURCE,
      defaultKey: "F12",
      icon: <FileCode2 className="h-3.5 w-3.5" />,
      run: goToDefinition,
    },
    {
      id: "find-references",
      label: "Find references",
      description: "List every reference to the symbol under the cursor.",
      category: "Code",
      source: SOURCE,
      defaultKey: "Shift+F12",
      icon: <Search className="h-3.5 w-3.5" />,
      run: findReferences,
    },
    {
      id: "go-to-implementation",
      label: "Go to implementation",
      description: "Jump to an implementation of the interface or method under the cursor.",
      category: "Code",
      source: SOURCE,
      defaultKey: "Mod+F12",
      icon: <GitBranch className="h-3.5 w-3.5" />,
      run: goToImplementation,
    },
    {
      id: "rename-symbol",
      label: "Rename symbol",
      description: "Rename the symbol at the cursor with language server edits.",
      category: "Code",
      source: SOURCE,
      defaultKey: "F2",
      icon: <Puzzle className="h-3.5 w-3.5" />,
      run: renameSymbol,
    },
    {
      id: "toggle-breakpoint",
      label: "Toggle breakpoint",
      description: "Add or remove a breakpoint on the current line.",
      category: "Debug",
      source: SOURCE,
      defaultKey: "F9",
      icon: <Bug className="h-3.5 w-3.5" />,
      run: () => activePath && toggleBreakpoint(activePath, cursorLine),
    },
    {
      id: "split-right",
      label: "Split editor right",
      description: "Create a new editor group to the right.",
      category: "Layout",
      source: SOURCE,
      defaultKey: "Mod+\\",
      icon: <Columns2 className="h-3.5 w-3.5" />,
      run: () => {
        if (!compact) split("right");
      },
    },
    {
      id: "split-down",
      label: "Split editor down",
      description: "Create a new editor group below.",
      category: "Layout",
      source: SOURCE,
      defaultKey: "Mod+Shift+\\",
      icon: <Rows2 className="h-3.5 w-3.5" />,
      run: () => {
        if (!compact) split("down");
      },
    },
    {
      id: "close-group",
      label: "Close editor group",
      description: "Close the active split group.",
      category: "Layout",
      source: SOURCE,
      defaultKey: "Mod+Alt+\\",
      icon: <X className="h-3.5 w-3.5" />,
      run: () => {
        if (layout.rows.flat().length > 1) closeEditorGroup(activeGroupIdOf(layout));
      },
    },
    {
      id: "toggle-maximize-panel",
      label: layout.bottomMaximized ? "Restore panel size" : "Maximize panel",
      description: "Grow the bottom panel to fill the workspace.",
      category: "Layout",
      source: SOURCE,
      icon: <Maximize2 className="h-3.5 w-3.5" />,
      run: () => setBottomMaximized(!layout.bottomMaximized),
    },
    {
      id: "reset-layout",
      label: "Reset layout",
      description: "Restore the default editor and panel layout.",
      category: "Layout",
      source: SOURCE,
      defaultKey: "Mod+Alt+0",
      icon: <RotateCcw className="h-3.5 w-3.5" />,
      run: () => reset(tabs.map((tab) => tab.path), activePath),
    },
    {
      id: "open-settings",
      label: "Open settings",
      description: "Open the workspace and editor settings.",
      category: "Workspace",
      source: SOURCE,
      icon: <Settings2 className="h-3.5 w-3.5" />,
      run: openSettings,
    },
    {
      id: "open-tokens",
      label: "Manage API tokens",
      description: "Create and revoke personal access tokens.",
      category: "Account",
      source: SOURCE,
      icon: <KeyRound className="h-3.5 w-3.5" />,
      run: openTokens,
    },
    {
      id: "open-byok",
      label: "Manage AI provider keys",
      description: "Configure bring-your-own-key providers.",
      category: "Account",
      source: SOURCE,
      icon: <Brain className="h-3.5 w-3.5" />,
      run: openByok,
    },
    ...pluginActions,
  ];
}
