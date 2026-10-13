-- The "Help" chat between a user and the admins.
CREATE TABLE "SupportChat" (
    "userId" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFromStaff" BOOLEAN NOT NULL DEFAULT false,
    "userUnread" INTEGER NOT NULL DEFAULT 0,
    "userReadAt" TIMESTAMP(3),
    "staffUnread" INTEGER NOT NULL DEFAULT 0,
    "staffReadAt" TIMESTAMP(3),

    CONSTRAINT "SupportChat_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "fromStaff" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportChat_lastMessageAt_idx" ON "SupportChat"("lastMessageAt");
CREATE INDEX "SupportMessage_chatId_createdAt_idx" ON "SupportMessage"("chatId", "createdAt");

ALTER TABLE "SupportChat" ADD CONSTRAINT "SupportChat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "SupportChat"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
