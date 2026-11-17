-- The support bot's daily report (/admin/support/raport).
CREATE TABLE "SupportBotCase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "askedAt" TIMESTAMP(3) NOT NULL,
    "answer" TEXT,
    "answeredAt" TIMESTAMP(3),
    "result" TEXT,
    "personAfter" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SupportBotCase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportBotCase_askedAt_idx" ON "SupportBotCase"("askedAt");
CREATE INDEX "SupportBotCase_userId_askedAt_idx" ON "SupportBotCase"("userId", "askedAt");

ALTER TABLE "SupportBotCase" ADD CONSTRAINT "SupportBotCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
