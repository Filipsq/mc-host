-- Klucz do wgrywania (src/lib/deployKey.ts): skrypt wgrywa pluginy i restartuje serwer bez logowania.
ALTER TABLE "Server" ADD COLUMN "deployKeyHash" TEXT;
