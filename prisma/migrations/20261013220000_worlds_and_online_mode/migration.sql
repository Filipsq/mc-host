-- Non-premium servers and the world a server runs.
-- AlterTable
ALTER TABLE "Server" ADD COLUMN     "level" TEXT,
ADD COLUMN     "levelSeed" TEXT,
ADD COLUMN     "levelType" TEXT,
ADD COLUMN     "onlineMode" BOOLEAN NOT NULL DEFAULT true;
