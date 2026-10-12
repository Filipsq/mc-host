-- Plans are bought for 7, 30, 60 or 90 days instead of 1 or 3 months (of 30 days).
ALTER TABLE "Payment" ADD COLUMN "days" INTEGER;
UPDATE "Payment" SET "days" = "months" * 30;
ALTER TABLE "Payment" ALTER COLUMN "days" SET NOT NULL;
ALTER TABLE "Payment" DROP COLUMN "months";
