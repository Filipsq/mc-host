-- Połączenie z hubem (src/lib/hubLink.ts): /hub to the network's hub and /wroc back.
ALTER TABLE "Server" ADD COLUMN "hubLink" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Server" ADD COLUMN "hubLinkPrivateKey" TEXT;
ALTER TABLE "Server" ADD COLUMN "hubLinkPublicKey" TEXT;
