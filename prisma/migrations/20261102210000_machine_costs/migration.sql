-- What each game machine costs a month, typed in by an admin on the overview page.
CREATE TABLE "MachineCost" (
    "node" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineCost_pkey" PRIMARY KEY ("node")
);
