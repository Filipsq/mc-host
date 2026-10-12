-- Checkout done, BLIK or Przelewy24 not confirmed yet.
ALTER TYPE "public"."PaymentStatus" ADD VALUE 'PROCESSING' AFTER 'PENDING';
