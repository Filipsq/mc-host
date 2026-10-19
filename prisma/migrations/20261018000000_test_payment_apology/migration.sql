-- AlterTable
ALTER TABLE "User" ADD COLUMN     "apologyDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentNoticeAt" TIMESTAMP(3);
