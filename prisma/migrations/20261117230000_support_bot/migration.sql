-- The support bot in the Help chat (src/lib/supportBot.ts).
ALTER TABLE "SupportChat" ADD COLUMN "botWaitingSince" TIMESTAMP(3);
ALTER TABLE "SupportChat" ADD COLUMN "botPausedUntil" TIMESTAMP(3);
ALTER TABLE "SupportMessage" ADD COLUMN "bot" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SupportBot" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportBot_pkey" PRIMARY KEY ("id")
);
