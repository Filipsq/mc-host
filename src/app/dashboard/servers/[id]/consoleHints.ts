import type { Messages } from "@/i18n/messages";

// Problems the console recognises in a server's log, so owners are told in
// plain words what went wrong and what to do (texts in server.hints). The
// first pattern that matches a line names its problem.
export type HintId = keyof Messages["server"]["hints"]["list"];

export const HINTS: { id: HintId; pattern: RegExp }[] = [
  { id: "invalidSession", pattern: /Failed to verify username|tried to join with an invalid session/ },
  { id: "oldWorld", pattern: /must be opened in an older version/ },
  { id: "worldTooNew", pattern: /No key dimensions in MapLike|No key seed|DETECTED OLD PLAYER DIRECTORY/ },
  { id: "brokenWorld", pattern: /Unable to read or access the world gen settings file|Overworld settings missing/ },
  { id: "duplicatePlugin", pattern: /Duplicate key|Ambiguous plugin name|Duplicate mod/i },
  { id: "missingDependency", pattern: /Missing or unsupported mandatory dependencies|Mod resolution failed|requires .{1,80} which is missing|Unknown\/missing dependency|Incompatible mods found/i },
  { id: "pluginOnModServer", pattern: /Bukkit or Bukkit-implementor/ },
  { id: "clientMod", pattern: /for invalid dist DEDICATED_SERVER|Environment type CLIENT|net\/minecraft\/client\// },
  { id: "javaTooOld", pattern: /UnsupportedClassVersionError|compiled by a more recent version of the Java Runtime/ },
  { id: "outOfMemory", pattern: /OutOfMemoryError/ },
  { id: "diskFull", pattern: /No space left on device/ },
  { id: "accessDenied", pattern: /AccessDeniedException|Permission denied/ },
  { id: "pluginSkipped", pattern: /has no compatible version for/ },
  { id: "overloaded", pattern: /Can't keep up! Is the server overloaded/ },
];

/** The problem a log line shows, if it's one the console knows. */
export function hintFor(line: string): HintId | undefined {
  return HINTS.find((h) => h.pattern.test(line))?.id;
}

// Lines that look like an error without being a known problem, shown in red.
const ERROR = /\b(ERROR|FATAL|SEVERE)\b|Exception|^\s*Caused by:|\bfailed\b/i;
export const isErrorLine = (line: string) => ERROR.test(line);
