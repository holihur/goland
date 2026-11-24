import { useCallback } from "react";
import { Puzzle } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "./api";
import type { PaletteAction } from "@/components/editor/CommandPalette";
import type { SideView } from "./layout";
import { pluginLspSocket } from "./plugin-api";
import type { WorkspacePlugin } from "./plugin-types";
import { usePlugins } from "./usePlugins";

export function usePluginContributions(workspaceId: string, activePath: string, cursorLine: number) {
  const runtime = usePlugins(workspaceId);

  const runPluginCommand = useCallback(
    (plugin: WorkspacePlugin, commandId: string, extra: Record<string, unknown> = {}) => {
      void runtime
        .execute(plugin.id, commandId, {
          path: activePath || undefined,
          selection: activePath
            ? { startLine: cursorLine, startColumn: 1, endLine: cursorLine, endColumn: 1 }
            : undefined,
          inputs: extra,
        })
        .then((result) => {
          const output = result.output.trim();
          if (output) toast.info(output.length > 400 ? `${output.slice(0, 400)}…` : output);
        })
        .catch((err) => toast.error(err instanceof ApiError ? err.message : "Plugin command failed"));
    },
    [runtime, activePath, cursorLine],
  );

  const pluginPanels = runtime.enabled.flatMap((plugin) =>
    (plugin.manifest?.contributes.panels ?? []).map((panel) => ({
      view: `plugin:${plugin.id}:${panel.id}` as SideView,
      title: panel.title,
    })),
  );

  const pluginEditorActions = activePath
    ? runtime.enabled.flatMap((plugin) =>
        (plugin.manifest?.contributes.editorActions ?? []).map((action) => ({
          id: `${plugin.id}:${action.id}`,
          title: `${plugin.name}: ${action.title}`,
          onSelect: () => runPluginCommand(plugin, action.command),
        })),
      )
    : [];

  const pluginPaletteActions: PaletteAction[] = [
    ...runtime.enabled.flatMap((plugin) =>
      (plugin.manifest?.contributes.commands ?? []).map((command) => ({
        id: `plugin:${plugin.id}:${command.id}`,
        label: `${plugin.name}: ${command.title}`,
        description: command.description,
        icon: <Puzzle className="h-3.5 w-3.5" />,
        run: () => runPluginCommand(plugin, command.id),
      })),
    ),
    ...pluginEditorActions.map((action) => ({
      id: `editor:${action.id}`,
      label: action.title,
      icon: <Puzzle className="h-3.5 w-3.5" />,
      run: action.onSelect,
    })),
  ];

  return { ...runtime, runPluginCommand, pluginPanels, pluginEditorActions, pluginPaletteActions, lspSocket: pluginLspSocket };
}
