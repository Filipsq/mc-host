-- Księga questów: the owner's first steps in the server panel (src/lib/quests.ts).
ALTER TABLE "Server" ADD COLUMN "questsDone" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Server" ADD COLUMN "questsHidden" BOOLEAN NOT NULL DEFAULT false;
