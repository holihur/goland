import { Columns2, FlaskConical, GitBranch, ListTree, Maximize2, RotateCcw, Rows2, Search, X } from "lucide-react";
import { activeGroupIdOf, type LayoutState } from "@/lib/layout";
import type { EditorTab } from "./EditorGroups";
import { paletteIcons, type PaletteAction } from "@/components/editor/paletteTypes";

export function buildPaletteActions({
  activePath,
  layout,
  tabs,
  compact,
  saveTab,
  toggleBottom,
  openBottom,
  showSideView,
  goToWorkspaceSymbol,
  split,
  closeEditorGroup,
  setBottomMaximized,
  reset,
  pluginActions,
}: {
  activePath: string;
  layout: LayoutState;
  tabs: EditorTab[];
  compact: boolean;
  saveTab: (path: string) => void;
  toggleBottom: () => void;
  openBottom: (view: "tests") => void;
  showSideView: (view: "outline" | "explorer" | "git") => void;
  goToWorkspaceSymbol: () => void;
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
      hint: "⌘S",
      icon: paletteIcons.save,
      run: () => activePath && void saveTab(activePath),
    },
    {
      id: "terminal",
      label: "Toggle terminal",
      hint: "⌘`",
      icon: paletteIcons.terminal,
      run: () => toggleBottom(),
    },
    {
      id: "tests",
      label: "Show tests",
      icon: <FlaskConical className="h-3.5 w-3.5" />,
      run: () => openBottom("tests"),
    },
    {
      id: "outline",
      label: "Show outline",
      icon: <ListTree className="h-3.5 w-3.5" />,
      run: () => showSideView("outline"),
    },
    {
      id: "workspace-symbol",
      label: "Go to symbol in workspace…",
      icon: <Search className="h-3.5 w-3.5" />,
      run: () => void goToWorkspaceSymbol(),
    },
    {
      id: "explorer",
      label: "Show explorer",
      icon: paletteIcons.explorer,
      run: () => showSideView("explorer"),
    },
    {
      id: "git",
      label: "Show source control",
      icon: <GitBranch className="h-3.5 w-3.5" />,
      run: () => showSideView("git"),
    },
    {
      id: "split-right",
      label: "Split editor right",
      hint: "⌘\\",
      icon: <Columns2 className="h-3.5 w-3.5" />,
      run: () => {
        if (!compact) split("right");
      },
    },
    {
      id: "split-down",
      label: "Split editor down",
      hint: "⌘⇧\\",
      icon: <Rows2 className="h-3.5 w-3.5" />,
      run: () => {
        if (!compact) split("down");
      },
    },
    {
      id: "close-group",
      label: "Close editor group",
      hint: "⌘⌥\\",
      icon: <X className="h-3.5 w-3.5" />,
      run: () => {
        if (layout.rows.flat().length > 1) closeEditorGroup(activeGroupIdOf(layout));
      },
    },
    {
      id: "maximize-panel",
      label: layout.bottomMaximized ? "Restore panel size" : "Maximize panel",
      icon: <Maximize2 className="h-3.5 w-3.5" />,
      run: () => setBottomMaximized(!layout.bottomMaximized),
    },
    {
      id: "reset-layout",
      label: "Reset layout",
      hint: "⌘⌥0",
      icon: <RotateCcw className="h-3.5 w-3.5" />,
      run: () => reset(tabs.map((tab) => tab.path), activePath),
    },
    ...pluginActions,
  ];
}
