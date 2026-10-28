-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "paysafecard" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hotpayId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_hotpayId_key" ON "Payment"("hotpayId");
