-- CreateTable
CREATE TABLE "Refusal" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "userId" TEXT,
    "serverId" TEXT,
    "node" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refusal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Refusal_createdAt_idx" ON "Refusal"("createdAt");
