import type { Messages } from "@/i18n/messages";

// The console's game, which decides which shortcuts make sense: Bedrock has no
// bans or save-all, Terraria has its own console commands, and TShock replaces
// those with its own (with names in quotes, since they can hold spaces).
export type ConsoleGame = "java" | "bedrock" | "terraria" | "tshock";

type Label = Exclude<keyof Messages["server"]["quick"], "title" | "nick" | "nickHint" | "message" | "player" | "world">;
export type QuickCommand = { label: Label; command: (nick: string) => string };

// A name typed into the panel, made safe to put into one console line.
export function cleanNick(nick: string) {
  return nick.replace(/["\r\n]/g, "").trim().slice(0, 32);
}

// Bedrock gamertags may hold spaces, so they go in quotes.
const quoted = (nick: string) => (/\s/.test(nick) ? `"${nick}"` : nick);

export const PLAYER_COMMANDS: Record<ConsoleGame, QuickCommand[]> = {
  java: [
    { label: "op", command: (n) => `op ${n}` },
    { label: "deop", command: (n) => `deop ${n}` },
    { label: "creative", command: (n) => `gamemode creative ${n}` },
    { label: "survival", command: (n) => `gamemode survival ${n}` },
    { label: "spectator", command: (n) => `gamemode spectator ${n}` },
    { label: "whitelistAdd", command: (n) => `whitelist add ${n}` },
    { label: "whitelistRemove", command: (n) => `whitelist remove ${n}` },
    { label: "kick", command: (n) => `kick ${n}` },
    { label: "ban", command: (n) => `ban ${n}` },
    { label: "pardon", command: (n) => `pardon ${n}` },
  ],
  bedrock: [
    { label: "op", command: (n) => `op ${quoted(n)}` },
    { label: "deop", command: (n) => `deop ${quoted(n)}` },
    { label: "creative", command: (n) => `gamemode creative ${quoted(n)}` },
    { label: "survival", command: (n) => `gamemode survival ${quoted(n)}` },
    { label: "whitelistAdd", command: (n) => `allowlist add ${quoted(n)}` },
    { label: "whitelistRemove", command: (n) => `allowlist remove ${quoted(n)}` },
    { label: "kick", command: (n) => `kick ${quoted(n)}` },
  ],
  terraria: [
    { label: "kick", command: (n) => `kick ${n}` },
    { label: "ban", command: (n) => `ban ${n}` },
  ],
  tshock: [
    { label: "kick", command: (n) => `kick "${n}"` },
    { label: "ban", command: (n) => `ban add "${n}"` },
  ],
};

export const WORLD_COMMANDS: Record<ConsoleGame, QuickCommand[]> = {
  java: [
    { label: "list", command: () => "list" },
    { label: "day", command: () => "time set day" },
    { label: "night", command: () => "time set night" },
    { label: "clear", command: () => "weather clear" },
    { label: "rain", command: () => "weather rain" },
    { label: "save", command: () => "save-all" },
  ],
  bedrock: [
    { label: "list", command: () => "list" },
    { label: "day", command: () => "time set day" },
    { label: "night", command: () => "time set night" },
    { label: "clear", command: () => "weather clear" },
    { label: "rain", command: () => "weather rain" },
  ],
  terraria: [
    { label: "list", command: () => "playing" },
    { label: "day", command: () => "dawn" },
    { label: "noon", command: () => "noon" },
    { label: "night", command: () => "dusk" },
    { label: "save", command: () => "save" },
  ],
  tshock: [
    { label: "list", command: () => "who" },
    { label: "day", command: () => "time day" },
    { label: "noon", command: () => "time noon" },
    { label: "night", command: () => "time night" },
    { label: "save", command: () => "save" },
  ],
};

