-- AlterTable
ALTER TABLE "public"."Server" ADD COLUMN     "port" INTEGER,
ADD COLUMN     "version" TEXT NOT NULL DEFAULT 'LATEST';

-- CreateIndex
CREATE UNIQUE INDEX "Server_port_key" ON "public"."Server"("port");

