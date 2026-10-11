-- CreateEnum
CREATE TYPE "public"."Edition" AS ENUM ('JAVA', 'BEDROCK');

-- CreateEnum
CREATE TYPE "public"."Plan" AS ENUM ('FREE', 'STARTER', 'STANDARD', 'PRO');

-- CreateEnum
CREATE TYPE "public"."ServerStatus" AS ENUM ('PROVISIONING', 'RUNNING', 'SLEEPING', 'STOPPED', 'SUSPENDED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Server" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "edition" "public"."Edition" NOT NULL DEFAULT 'JAVA',
    "plan" "public"."Plan" NOT NULL DEFAULT 'FREE',
    "status" "public"."ServerStatus" NOT NULL DEFAULT 'PROVISIONING',
    "memoryMb" INTEGER NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Server_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE INDEX "Server_ownerId_idx" ON "public"."Server"("ownerId");

-- AddForeignKey
ALTER TABLE "public"."Server" ADD CONSTRAINT "Server_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
