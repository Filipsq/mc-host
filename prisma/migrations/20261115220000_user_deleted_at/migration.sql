-- Accounts deleted but kept for their paid payments (src/lib/accountDeletion.ts).
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
