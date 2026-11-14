-- AlterTable
ALTER TABLE "Server" ADD COLUMN "pluginVersions" TEXT[] DEFAULT ARRAY[]::TEXT[];
