ALTER TABLE "Server" ADD COLUMN "adBoost" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Server" ADD COLUMN "adBoostUntil" TIMESTAMP(3);

CREATE TABLE "AdWatch" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdWatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdWatch_serverId_createdAt_idx" ON "AdWatch"("serverId", "createdAt");

ALTER TABLE "AdWatch" ADD CONSTRAINT "AdWatch_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
