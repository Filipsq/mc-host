-- Admins' second step (authenticator app) and email confirmation before friends' invites join an account.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpSecret" TEXT;

-- Google already confirmed these accounts' addresses.
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP WHERE "googleId" IS NOT NULL;
