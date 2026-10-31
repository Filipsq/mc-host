-- Minigames turned on from the panel: what the server ran before, and the minigames world.
ALTER TABLE "Server" ADD COLUMN "minigamesBack" JSONB;
ALTER TABLE "Server" ADD COLUMN "minigamesLevel" TEXT;
