-- AlterTable
ALTER TABLE "public"."Server" ADD COLUMN     "plugins" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "pluginsPending" BOOLEAN NOT NULL DEFAULT false;
