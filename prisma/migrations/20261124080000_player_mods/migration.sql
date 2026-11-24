-- "Mody dla graczy": the players' download link and the mods folder's hashes (src/lib/playerMods.ts).
ALTER TABLE "Server" ADD COLUMN "playerModsToken" TEXT;
ALTER TABLE "Server" ADD COLUMN "playerModsHashes" JSONB;
CREATE UNIQUE INDEX "Server_playerModsToken_key" ON "Server"("playerModsToken");
