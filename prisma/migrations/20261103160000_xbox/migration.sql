-- AlterTable
ALTER TABLE "Server" ADD COLUMN     "xbox" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "xboxUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "xboxDays" INTEGER NOT NULL DEFAULT 0;
