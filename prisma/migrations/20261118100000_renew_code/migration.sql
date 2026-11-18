-- A one-off -20% code for extending a paid server, sent with the reminder 3 days before it ends (src/lib/renewCode.ts).
ALTER TABLE "Server" ADD COLUMN "renewCode" TEXT;
ALTER TABLE "Server" ADD COLUMN "renewCodeUntil" TIMESTAMP(3);
ALTER TABLE "Server" ADD COLUMN "renewCodeUsedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Server_renewCode_key" ON "Server"("renewCode");
