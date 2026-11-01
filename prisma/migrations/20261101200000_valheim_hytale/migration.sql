ALTER TYPE "Edition" ADD VALUE 'VALHEIM';
ALTER TYPE "Edition" ADD VALUE 'HYTALE';

CREATE TABLE "HytaleAuth" (
    "id" TEXT NOT NULL,
    "refreshToken" TEXT,
    "accessToken" TEXT,
    "accessUntil" TIMESTAMP(3),
    "profileUuid" TEXT,
    "profileName" TEXT,
    "deviceCode" TEXT,
    "userCode" TEXT,
    "verifyUrl" TEXT,
    "deviceUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HytaleAuth_pkey" PRIMARY KEY ("id")
);
