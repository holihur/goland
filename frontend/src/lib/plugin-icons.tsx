import {
  Box,
  Boxes,
  Braces,
  Container,
  Database,
  FileJson,
  GitBranch,
  Globe,
  Network,
  Package,
  Puzzle,
  Server,
  Sparkles,
  Terminal,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  box: Box,
  boxes: Boxes,
  braces: Braces,
  container: Container,
  database: Database,
  "file-json": FileJson,
  git: GitBranch,
  globe: Globe,
  network: Network,
  package: Package,
  server: Server,
  sparkles: Sparkles,
  terminal: Terminal,
};

export function pluginIcon(name: string | undefined, className = "h-3.5 w-3.5") {
  const Icon = (name && ICONS[name]) || Puzzle;
  return <Icon className={className} />;
}
