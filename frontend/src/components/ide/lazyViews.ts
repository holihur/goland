import { lazy } from "react";

export const DebugPanel = lazy(() =>
  import("@/components/editor/DebugPanel").then((module) => ({ default: module.DebugPanel })),
);
export const CommandPalette = lazy(() =>
  import("@/components/editor/CommandPalette").then((module) => ({ default: module.CommandPalette })),
);
export const SettingsDialog = lazy(() =>
  import("@/components/SettingsDialog").then((module) => ({ default: module.SettingsDialog })),
);
export const TokenDialog = lazy(() =>
  import("@/components/TokenDialog").then((module) => ({ default: module.TokenDialog })),
);
export const ByokDialog = lazy(() =>
  import("@/components/ByokDialog").then((module) => ({ default: module.ByokDialog })),
);
export const SearchPanel = lazy(() =>
  import("@/components/editor/SearchPanel").then((module) => ({ default: module.SearchPanel })),
);
export const OutlinePanel = lazy(() =>
  import("@/components/editor/OutlinePanel").then((module) => ({ default: module.OutlinePanel })),
);
export const GitPanel = lazy(() =>
  import("@/components/editor/GitPanel").then((module) => ({ default: module.GitPanel })),
);
export const ManagerDialog = lazy(() =>
  import("./ManagerDialog").then((module) => ({ default: module.ManagerDialog })),
);
