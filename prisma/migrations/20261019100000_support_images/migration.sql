-- AlterTable
ALTER TABLE "SupportMessage" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SupportImage" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "SupportImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportMessage_chatId_deletedAt_idx" ON "SupportMessage"("chatId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportImage_messageId_key" ON "SupportImage"("messageId");

-- AddForeignKey
ALTER TABLE "SupportImage" ADD CONSTRAINT "SupportImage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
