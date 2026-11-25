import type { NavGroup, NavItem } from "@/app/dashboard/servers/[id]/ServerNav";

/**
 * Księga questów: the owner's first steps in a new server's panel, on the right
 * of the panel. Each quest is a tab to open (opening it does the quest), apart
 * from "create" (done already) and "start" (done once the server has run).
 * Only tabs this server really has become quests, so a Bedrock server never
 * asks for plugins and a mod pack never asks for Paper plugins.
 */
export const QUEST_KEYS = ["create", "start", "console", "plugins", "mods", "bedrockAddons", "files", "settings", "backups", "access"] as const;
export type QuestKey = (typeof QUEST_KEYS)[number];
export const isQuestKey = (k: string): k is QuestKey => (QUEST_KEYS as readonly string[]).includes(k);

export type Quest = { key: QuestKey; path: string | null; label: string };

export type QuestLabels = Record<Exclude<QuestKey, "plugins" | "mods">, string> & {
  plugins: string;
  mods: string;
  workshop: string;
};

/** The quests for this server, in order, from the menu it shows. */
export function questsFor(groups: NavGroup[], addons: "plugin" | "mod" | "workshop" | null, t: QuestLabels): Quest[] {
  const items = new Map<string, NavItem>(groups.flatMap((g) => g.items.map((i) => [i.key, i] as const)));
  const tab = (key: QuestKey, nav: string, label: string): Quest | null => {
    const item = items.get(nav);
    return item ? { key, path: item.path, label } : null;
  };
  const list: (Quest | null)[] = [
    { key: "create", path: null, label: t.create },
    { key: "start", path: "", label: t.start },
    tab("console", "console", t.console),
    // The plugins tab holds mods on a Fabric/Forge server and Workshop mods on tModLoader.
    tab(addons === "mod" ? "mods" : "plugins", "plugins", addons === "mod" ? t.mods : addons === "workshop" ? t.workshop : t.plugins),
    // Vanilla (where mods mean changing the type) and mod packs have their own mods tab.
    addons !== "mod" ? tab("mods", "mods", t.mods) : null,
    tab("bedrockAddons", "bedrockAddons", t.bedrockAddons),
    tab("files", "files", t.files),
    tab("settings", "settings", t.settings),
    tab("backups", "backups", t.backups),
    tab("access", "access", t.access),
  ];
  return list.filter((q): q is Quest => !!q);
}
