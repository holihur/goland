import { useCallback } from "react";
import { Puzzle } from "lucide-react";
import { pluginIcon } from "./plugin-icons";
import { toast } from "sonner";
import { ApiError } from "./api";
import type { PaletteAction } from "@/components/editor/paletteTypes";
import type { PluginKeybindingContribution } from "./commands";
import type { PluginMenuContribution } from "./menus";
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

  const pluginPanels = runtime.enabled.flatMap((plugin) => {
    const fallbackIcon = plugin.manifest?.icon;
    return [
      ...(plugin.manifest?.contributes.panels ?? []).map((panel) => ({
        view: `plugin:${plugin.id}:${panel.id}` as SideView,
        title: panel.title,
        icon: pluginIcon(panel.icon ?? fallbackIcon, "h-[18px] w-[18px]"),
      })),
      ...(plugin.manifest?.contributes.frontends ?? []).map((frontend) => ({
        view: `plugin:${plugin.id}:${frontend.id}` as SideView,
        title: frontend.title,
        icon: pluginIcon(frontend.icon ?? fallbackIcon, "h-[18px] w-[18px]"),
      })),
    ];
  });

  const pluginEditorActions = activePath
    ? runtime.enabled.flatMap((plugin) =>
        (plugin.manifest?.contributes.editorActions ?? []).map((action) => ({
          id: `${plugin.id}:${action.id}`,
          title: `${plugin.name}: ${action.title}`,
          onSelect: () => runPluginCommand(plugin, action.command),
        })),
      )
    : [];

  const pluginKeybindings: PluginKeybindingContribution[] = runtime.enabled.flatMap((plugin) =>
    (plugin.manifest?.contributes.keybindings ?? []).map((binding) => ({
      pluginId: plugin.id,
      pluginName: plugin.name,
      commandId: `plugin:${plugin.id}:${binding.command}`,
      key: binding.key,
    })),
  );

  const pluginMenus: PluginMenuContribution[] = runtime.enabled.flatMap((plugin) =>
    (plugin.manifest?.contributes.menus ?? []).flatMap((menu) =>
      menu.items.map((item) => ({
        pluginId: plugin.id,
        pluginName: plugin.name,
        menuId: menu.id,
        label: menu.label,
        commandId: `plugin:${plugin.id}:${item.command}`,
        group: item.group,
      })),
    ),
  );

  const pluginPaletteActions: PaletteAction[] = [
    ...runtime.enabled.flatMap((plugin) =>
      (plugin.manifest?.contributes.commands ?? []).map((command) => {
        const commandId = `plugin:${plugin.id}:${command.id}`;
        const prefix = `${plugin.name}: `;
        return {
          id: commandId,
          label: command.title.startsWith(prefix) ? command.title : `${prefix}${command.title}`,
          description: command.description,
          category: command.category || "Plugins",
          source: plugin.name,
          defaultKey: pluginKeybindings.find((binding) => binding.commandId === commandId)?.key,
          icon: pluginIcon(plugin.manifest?.icon, "h-3.5 w-3.5"),
          run: () => runPluginCommand(plugin, command.id),
        };
      }),
    ),
    ...pluginEditorActions.map((action) => ({
      id: `editor:${action.id}`,
      label: action.title,
      description: "Plugin editor action",
      category: "Plugins",
      source: action.title.split(":")[0] || "Plugin",
      icon: <Puzzle className="h-3.5 w-3.5" />,
      run: action.onSelect,
    })),
  ];

  return {
    ...runtime,
    runPluginCommand,
    pluginPanels,
    pluginEditorActions,
    pluginPaletteActions,
    pluginKeybindings,
    pluginMenus,
    lspSocket: pluginLspSocket,
  };
}
