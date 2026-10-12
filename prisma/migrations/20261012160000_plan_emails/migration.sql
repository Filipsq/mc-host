-- AlterTable
ALTER TABLE "public"."Server" ADD COLUMN     "reminderSentFor" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'pl';
