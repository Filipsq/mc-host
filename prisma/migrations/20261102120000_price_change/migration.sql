ALTER TABLE "Server" ADD COLUMN "oldPriceUntil" TIMESTAMP(3);
ALTER TABLE "Server" ADD COLUMN "priceNoticeAt" TIMESTAMP(3);

-- Prices went up on this deploy (VAT now on top of what we keep). Servers that
-- already renew by card keep the earlier price for 15 more days: the billing job
-- mails their owners right away, which is the 14 days' notice the terms promise.
UPDATE "Server" SET "oldPriceUntil" = NOW() + INTERVAL '15 days'
WHERE "autoRenew" = true AND "plan" <> 'FREE';
