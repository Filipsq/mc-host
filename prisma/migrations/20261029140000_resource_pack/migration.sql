ALTER TABLE "Server" ADD COLUMN "resourcePack" TEXT,
ADD COLUMN "resourcePackSha1" TEXT,
ADD COLUMN "resourcePackRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "resourcePackPrompt" TEXT NOT NULL DEFAULT '';
