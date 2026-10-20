ALTER TABLE "Server" ADD COLUMN "maxPlayers" INTEGER;
ALTER TABLE "Server" ADD COLUMN "allowFlight" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Server" ADD COLUMN "hardcore" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Server" ADD COLUMN "commandBlocks" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Server" ADD COLUMN "spawnProtection" INTEGER NOT NULL DEFAULT 16;
-- Mods with jetpacks and wings get players kicked for flying otherwise.
UPDATE "Server" SET "allowFlight" = true WHERE "kind" IN ('modpack', 'fabric', 'forge', 'neoforge');
