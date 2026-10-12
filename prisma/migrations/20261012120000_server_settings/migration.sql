-- AlterTable
ALTER TABLE "Server" ADD COLUMN     "difficulty" TEXT NOT NULL DEFAULT 'easy',
ADD COLUMN     "gameMode" TEXT NOT NULL DEFAULT 'survival',
ADD COLUMN     "motd" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "pvp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "whitelist" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whitelistPlayers" TEXT[] DEFAULT ARRAY[]::TEXT[];
