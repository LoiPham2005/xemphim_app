-- DropIndex
DROP INDEX "user_profiles_full_name_trgm_idx";

-- DropIndex
DROP INDEX "users_email_trgm_idx";

-- DropIndex
DROP INDEX "users_username_trgm_idx";

-- AlterTable
ALTER TABLE "files" ALTER COLUMN "size" SET DATA TYPE BIGINT;

-- CreateTable
CREATE TABLE "movies" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "release_year" INTEGER,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "video_file_id" TEXT NOT NULL,
    "poster_file_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "movies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "movies_video_file_id_key" ON "movies"("video_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "movies_poster_file_id_key" ON "movies"("poster_file_id");

-- CreateIndex
CREATE INDEX "movies_published_created_at_idx" ON "movies"("published", "created_at");

-- AddForeignKey
ALTER TABLE "movies" ADD CONSTRAINT "movies_video_file_id_fkey" FOREIGN KEY ("video_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movies" ADD CONSTRAINT "movies_poster_file_id_fkey" FOREIGN KEY ("poster_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
