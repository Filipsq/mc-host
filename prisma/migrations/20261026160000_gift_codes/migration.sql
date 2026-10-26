ALTER TABLE "Payment" ADD COLUMN "redeemedGiftId" TEXT;

CREATE TABLE "GiftCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "days" INTEGER NOT NULL,
    "paymentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "redeemedById" TEXT,
    "serverId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GiftCode_code_key" ON "GiftCode"("code");
CREATE UNIQUE INDEX "GiftCode_paymentId_key" ON "GiftCode"("paymentId");
CREATE INDEX "GiftCode_buyerId_idx" ON "GiftCode"("buyerId");
CREATE INDEX "GiftCode_redeemedById_idx" ON "GiftCode"("redeemedById");

ALTER TABLE "GiftCode" ADD CONSTRAINT "GiftCode_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiftCode" ADD CONSTRAINT "GiftCode_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GiftCode" ADD CONSTRAINT "GiftCode_redeemedById_fkey" FOREIGN KEY ("redeemedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
