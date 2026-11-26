import type { ReactNode } from "react";
import { FolderOpen, Save, TerminalSquare } from "lucide-react";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  description?: string;
  category?: string;
  source?: string;
  defaultKey?: string;
  keywords?: string[];
  icon?: ReactNode;
  run: () => void;
}

export const paletteIcons = {
  save: <Save className="h-3.5 w-3.5" />,
  terminal: <TerminalSquare className="h-3.5 w-3.5" />,
  explorer: <FolderOpen className="h-3.5 w-3.5" />,
};
