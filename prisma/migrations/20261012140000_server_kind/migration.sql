-- AlterTable
ALTER TABLE "public"."Server" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'vanilla',
ADD COLUMN     "modpack" TEXT,
ADD COLUMN     "modpackLoader" TEXT,
ADD COLUMN     "modpackTitle" TEXT,
ADD COLUMN     "modpackVersion" TEXT,
ADD COLUMN     "modpackVersionId" TEXT;
