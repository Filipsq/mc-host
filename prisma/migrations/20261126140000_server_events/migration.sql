-- Server history for admins (src/lib/serverEvents.ts).
CREATE TABLE "ServerEvent" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "actor" TEXT NOT NULL DEFAULT 'system',
    "actorEmail" TEXT,
    "ref" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServerEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServerEvent_serverId_kind_ref_key" ON "ServerEvent"("serverId", "kind", "ref");
CREATE INDEX "ServerEvent_serverId_createdAt_idx" ON "ServerEvent"("serverId", "createdAt");
ALTER TABLE "ServerEvent" ADD CONSTRAINT "ServerEvent_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
