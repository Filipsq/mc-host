-- CreateTable
CREATE TABLE "Announcement" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "text" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
