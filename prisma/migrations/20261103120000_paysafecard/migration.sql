-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "paysafecard" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cashbillId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_cashbillId_key" ON "Payment"("cashbillId");
