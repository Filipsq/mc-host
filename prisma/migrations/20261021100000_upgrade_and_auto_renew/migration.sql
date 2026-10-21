ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

ALTER TABLE "Server" ADD COLUMN "autoRenew" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Server" ADD COLUMN "renewDays" INTEGER;
ALTER TABLE "Server" ADD COLUMN "renewCurrency" TEXT;
ALTER TABLE "Server" ADD COLUMN "renewCard" TEXT;
ALTER TABLE "Server" ADD COLUMN "renewCardLabel" TEXT;
ALTER TABLE "Server" ADD COLUMN "renewTriedFor" TIMESTAMP(3);

ALTER TABLE "Payment" ADD COLUMN "upgradeFrom" "Plan";
ALTER TABLE "Payment" ADD COLUMN "autoRenew" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payment" ADD COLUMN "renewal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payment" ADD COLUMN "stripePaymentIntentId" TEXT;
CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId");
