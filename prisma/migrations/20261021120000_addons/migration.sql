ALTER TABLE "Server" ADD COLUMN "addons" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Server" ADD COLUMN "customDomain" TEXT;
CREATE UNIQUE INDEX "Server_customDomain_key" ON "Server"("customDomain");

ALTER TABLE "Payment" ADD COLUMN "addons" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Payment" ADD COLUMN "addonsOnly" BOOLEAN NOT NULL DEFAULT false;
