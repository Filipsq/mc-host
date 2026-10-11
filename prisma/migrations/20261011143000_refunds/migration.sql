-- Refunds and chargebacks are matched to payments by their PaymentIntent.
ALTER TYPE "public"."PaymentStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "public"."PaymentStatus" ADD VALUE 'DISPUTED';

ALTER TABLE "public"."Payment" ADD COLUMN "stripePaymentIntentId" TEXT,
ADD COLUMN "amountRefunded" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "public"."Payment"("stripePaymentIntentId");
