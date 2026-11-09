-- AlterTable
ALTER TABLE "Review" ADD COLUMN "reply" TEXT,
ADD COLUMN "repliedAt" TIMESTAMP(3),
ADD COLUMN "replySeenAt" TIMESTAMP(3);
