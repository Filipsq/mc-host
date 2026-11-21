-- When each machine is paid for next, how long a payment covers, and whether its price was typed with VAT.
ALTER TABLE "MachineCost" ADD COLUMN "gross" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MachineCost" ADD COLUMN "periodMonths" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "MachineCost" ADD COLUMN "nextPayment" DATE;
ALTER TABLE "MachineCost" ADD COLUMN "label" TEXT;
