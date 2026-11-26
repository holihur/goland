import type { CommandDescriptor } from "./commands";

export interface MenuItemDefinition {
  id: string;
  commandId?: string;
  label?: string;
  separator?: boolean;
  group?: string;
}

export interface MenuDefinition {
  id: string;
  label: string;
  items: MenuItemDefinition[];
}

export interface PluginMenuContribution {
  pluginId: string;
  pluginName: string;
  menuId: string;
  label?: string;
  commandId: string;
  group?: string;
}

export interface MenuPreferences {
  hidden: string[];
  order: Record<string, string[]>;
}

const BUILTIN_MENUS: Array<{ id: string; label: string; items: Array<[string, string?]> }> = [
  {
    id: "file",
    label: "File",
    items: [
      ["save", "Editor"],
      ["close-tab", "Editor"],
      ["command-palette", "Workspace"],
      ["open-managers", "Configuration"],
    ],
  },
  {
    id: "edit",
    label: "Edit",
    items: [
      ["rename-symbol", "Code"],
      ["workspace-symbol", "Navigate"],
      ["show-search", "Navigate"],
    ],
  },
  {
    id: "view",
    label: "View",
    items: [
      ["show-explorer", "Panels"],
      ["show-search", "Panels"],
      ["show-outline", "Panels"],
      ["show-git", "Panels"],
      ["toggle-sidebar", "Layout"],
      ["toggle-sidebar-position", "Layout"],
      ["toggle-terminal", "Layout"],
      ["toggle-maximize-panel", "Layout"],
      ["reset-layout", "Layout"],
    ],
  },
  {
    id: "run",
    label: "Run",
    items: [
      ["start-debug", "Debug"],
      ["toggle-breakpoint", "Debug"],
      ["show-tests", "Test"],
    ],
  },
  {
    id: "tools",
    label: "Tools",
    items: [],
  },
  {
    id: "help",
    label: "Help",
    items: [
      ["open-managers", "Configuration"],
      ["open-settings", "Workspace"],
      ["open-tokens", "Account"],
      ["open-byok", "Account"],
    ],
  },
];

const MENU_PREFERENCES_PREFIX = "goland.menus.";

export function itemPreferenceKey(menuId: string, itemId: string): string {
  return `${menuId}:${itemId}`;
}

export function buildMenus(commands: CommandDescriptor[], contributions: PluginMenuContribution[]): MenuDefinition[] {
  const byId = new Map(commands.map((command) => [command.id, command]));
  const menus: MenuDefinition[] = BUILTIN_MENUS.map((menu) => ({
    id: menu.id,
    label: menu.label,
    items: menu.items
      .filter(([commandId]) => byId.has(commandId))
      .map(([commandId, group]) => ({
        id: commandId,
        commandId,
        label: byId.get(commandId)?.title,
        group,
      })),
  }));
  const placed = new Set<string>();
  for (const menu of menus) {
    for (const item of menu.items) if (item.commandId) placed.add(item.commandId);
  }

  for (const contribution of contributions) {
    if (!byId.has(contribution.commandId)) continue;
    let menu = menus.find((item) => item.id === contribution.menuId);
    if (!menu) {
      menu = { id: contribution.menuId, label: contribution.label || contribution.menuId, items: [] };
      menus.push(menu);
    }
    menu.items.push({
      id: `plugin:${contribution.pluginId}:${contribution.menuId}:${contribution.commandId}:${menu.items.length}`,
      commandId: contribution.commandId,
      label: byId.get(contribution.commandId)?.title,
      group: contribution.group || contribution.pluginName,
    });
    placed.add(contribution.commandId);
  }

  // Plugin commands are discoverable even if a package does not declare menus.
  const tools = menus.find((menu) => menu.id === "tools");
  for (const command of commands) {
    if ((command.source ?? "Goland") === "Goland" || placed.has(command.id)) continue;
    tools?.items.push({ id: command.id, commandId: command.id, label: command.title, group: command.source });
  }
  return menus.filter((menu) => menu.items.length > 0);
}

export function applyMenuPreferences(menus: MenuDefinition[], preferences: MenuPreferences): MenuDefinition[] {
  const hidden = new Set(preferences.hidden);
  return menus
    .map((menu) => {
      const order = preferences.order[menu.id] ?? [];
      const rank = new Map(order.map((id, index) => [id, index]));
      const items = menu.items
        .filter((item) => !hidden.has(itemPreferenceKey(menu.id, item.id)))
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
          const aRank = rank.get(a.item.id);
          const bRank = rank.get(b.item.id);
          if (aRank === undefined && bRank === undefined) return a.index - b.index;
          if (aRank === undefined) return 1;
          if (bRank === undefined) return -1;
          return aRank - bRank;
        })
        .map(({ item }) => item);
      return { ...menu, items: normalizeSeparators(items) };
    })
    .filter((menu) => menu.items.some((item) => !item.separator));
}

function normalizeSeparators(items: MenuItemDefinition[]): MenuItemDefinition[] {
  const result: MenuItemDefinition[] = [];
  for (const item of items) {
    if (item.separator) {
      if (result.length === 0 || result[result.length - 1]?.separator) continue;
    }
    result.push(item);
  }
  while (result.length > 0 && result[result.length - 1]?.separator) result.pop();
  return result;
}

export function loadMenuPreferences(userId: string): MenuPreferences {
  try {
    const raw = localStorage.getItem(`${MENU_PREFERENCES_PREFIX}${userId}`);
    if (!raw) return { hidden: [], order: {} };
    const parsed = JSON.parse(raw) as Partial<MenuPreferences>;
    return {
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((item): item is string => typeof item === "string") : [],
      order:
        parsed.order && typeof parsed.order === "object"
          ? Object.fromEntries(
              Object.entries(parsed.order).map(([menuId, value]) => [
                menuId,
                Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [],
              ]),
            )
          : {},
    };
  } catch {
    return { hidden: [], order: {} };
  }
}

export function saveMenuPreferences(userId: string, preferences: MenuPreferences) {
  try {
    localStorage.setItem(`${MENU_PREFERENCES_PREFIX}${userId}`, JSON.stringify(preferences));
  } catch {
    // ignore storage failures
  }
}

export function toggleMenuItem(preferences: MenuPreferences, menuId: string, itemId: string): MenuPreferences {
  const key = itemPreferenceKey(menuId, itemId);
  const hidden = preferences.hidden.includes(key)
    ? preferences.hidden.filter((item) => item !== key)
    : [...preferences.hidden, key];
  return { ...preferences, hidden };
}

export function moveMenuItem(preferences: MenuPreferences, menu: MenuDefinition, itemId: string, direction: -1 | 1): MenuPreferences {
  const visible = menu.items.filter((item) => !item.separator).map((item) => item.id);
  const index = visible.indexOf(itemId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= visible.length) return preferences;
  [visible[index], visible[target]] = [visible[target], visible[index]];
  return { ...preferences, order: { ...preferences.order, [menu.id]: visible } };
}
