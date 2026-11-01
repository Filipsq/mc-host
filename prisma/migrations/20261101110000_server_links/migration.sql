-- Linked servers: players move between an owner's servers in the game.
ALTER TABLE "Server" ADD COLUMN "linkGroup" TEXT;
ALTER TABLE "Server" ADD COLUMN "links" TEXT[] DEFAULT ARRAY[]::TEXT[];
