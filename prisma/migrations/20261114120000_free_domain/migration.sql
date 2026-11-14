-- AlterTable
ALTER TABLE "Server" ADD COLUMN     "domainUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "domainDays" INTEGER NOT NULL DEFAULT 0;
