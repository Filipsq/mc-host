-- The players' chat (src/lib/lobby.ts): nicknames and mutes on User, messages, reports and the on/off switch.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "chatMutedUntil" TIMESTAMP(3),
ADD COLUMN     "chatName" TEXT,
ADD COLUMN     "chatNameKey" TEXT;

-- CreateTable
CREATE TABLE "LobbyMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromAdmin" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "serverId" TEXT,
    "serverName" TEXT,
    "serverAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "hiddenByReports" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LobbyMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LobbyReport" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "LobbyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LobbySwitch" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LobbySwitch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LobbyMessage_createdAt_idx" ON "LobbyMessage"("createdAt");

-- CreateIndex
CREATE INDEX "LobbyMessage_deletedAt_idx" ON "LobbyMessage"("deletedAt");

-- CreateIndex
CREATE INDEX "LobbyMessage_userId_createdAt_idx" ON "LobbyMessage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LobbyReport_resolvedAt_idx" ON "LobbyReport"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LobbyReport_messageId_reporterId_key" ON "LobbyReport"("messageId", "reporterId");

-- CreateIndex
CREATE UNIQUE INDEX "User_chatNameKey_key" ON "User"("chatNameKey");

-- AddForeignKey
ALTER TABLE "LobbyMessage" ADD CONSTRAINT "LobbyMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyReport" ADD CONSTRAINT "LobbyReport_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "LobbyMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyReport" ADD CONSTRAINT "LobbyReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

