import type { Server } from "@prisma/client";

// Bedrock add-ons (.mcaddon, .mcpack): uploaded into this folder of the
// server's files, then unpacked and turned on by the agent (agent/bedrockpacks.go).
export const ADDON_UPLOAD_DIR = ".addon-uploads";
export const ADDON_FILE_TYPES = [".mcaddon", ".mcpack", ".zip"];

/** A plain Bedrock server runs add-ons; a crossplay server is Java with Geyser, which can't. */
export const takesBedrockAddons = (s: Pick<Server, "edition">) => s.edition === "BEDROCK";

export const addonUploadPattern = new RegExp(`^${ADDON_UPLOAD_DIR.replace(".", "\\.")}/[a-z0-9]{8,32}\\.(mcaddon|mcpack|zip)$`);
