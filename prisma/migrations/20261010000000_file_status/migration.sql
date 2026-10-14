-- CreateEnum
CREATE TYPE "file_status" AS ENUM ('PENDING', 'READY');

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "retained" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" "file_status" NOT NULL DEFAULT 'READY',
ALTER COLUMN "sha256" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "files_status_created_at_idx" ON "files"("status", "created_at");

