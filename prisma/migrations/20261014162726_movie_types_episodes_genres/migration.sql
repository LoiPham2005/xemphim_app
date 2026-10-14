-- Loại phim + tập phim + thể loại.
-- Thứ tự có chủ đích: tạo bảng `episodes` và CHÉP video hiện có thành "Tập 1" TRƯỚC khi xoá cột
-- `movies.video_file_id` — làm ngược lại là mất liên kết phim ↔ video của mọi phim đã đăng.

-- CreateEnum
CREATE TYPE "movie_type" AS ENUM ('SINGLE', 'SERIES', 'THEATRICAL');

-- AlterTable
ALTER TABLE "movies" ADD COLUMN "type" "movie_type" NOT NULL DEFAULT 'SINGLE';

-- CreateTable
CREATE TABLE "episodes" (
    "id" TEXT NOT NULL,
    "movie_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT,
    "video_file_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id")
);

-- Chuyển dữ liệu: mỗi phim cũ thành phim lẻ có đúng một tập.
INSERT INTO "episodes" ("id", "movie_id", "number", "video_file_id", "created_at")
SELECT 'ep_' || "id", "id", 1, "video_file_id", "created_at" FROM "movies";

-- DropForeignKey
ALTER TABLE "movies" DROP CONSTRAINT "movies_video_file_id_fkey";

-- DropIndex
DROP INDEX "movies_video_file_id_key";

-- AlterTable
ALTER TABLE "movies" DROP COLUMN "video_file_id";

-- CreateTable
CREATE TABLE "genres" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "genres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movie_genres" (
    "movie_id" TEXT NOT NULL,
    "genre_id" TEXT NOT NULL,

    CONSTRAINT "movie_genres_pkey" PRIMARY KEY ("movie_id","genre_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "episodes_video_file_id_key" ON "episodes"("video_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "episodes_movie_id_number_key" ON "episodes"("movie_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "genres_name_key" ON "genres"("name");

-- CreateIndex
CREATE UNIQUE INDEX "genres_slug_key" ON "genres"("slug");

-- CreateIndex
CREATE INDEX "movie_genres_genre_id_idx" ON "movie_genres"("genre_id");

-- CreateIndex
CREATE INDEX "movies_type_published_created_at_idx" ON "movies"("type", "published", "created_at");

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_video_file_id_fkey" FOREIGN KEY ("video_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movie_genres" ADD CONSTRAINT "movie_genres_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movie_genres" ADD CONSTRAINT "movie_genres_genre_id_fkey" FOREIGN KEY ("genre_id") REFERENCES "genres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Thể loại mặc định — admin thêm/xoá được ở trang quản lý phim.
INSERT INTO "genres" ("id", "name", "slug") VALUES
  ('genre_action', 'Hành động', 'hanh-dong'),
  ('genre_romance', 'Tình cảm', 'tinh-cam'),
  ('genre_comedy', 'Hài', 'hai'),
  ('genre_horror', 'Kinh dị', 'kinh-di'),
  ('genre_animation', 'Hoạt hình', 'hoat-hinh'),
  ('genre_scifi', 'Viễn tưởng', 'vien-tuong'),
  ('genre_drama', 'Tâm lý', 'tam-ly'),
  ('genre_adventure', 'Phiêu lưu', 'phieu-luu'),
  ('genre_crime', 'Hình sự', 'hinh-su'),
  ('genre_documentary', 'Tài liệu', 'tai-lieu');
