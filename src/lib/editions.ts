import type { Edition } from "@prisma/client";

/** How each game is named in the panel. */
export const EDITION_NAMES: Record<Edition, string> = { JAVA: "Java", BEDROCK: "Bedrock", TERRARIA: "Terraria" };
