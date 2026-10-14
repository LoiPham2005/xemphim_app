import { z } from "zod";
import { emptyToUndefined, paginationSchema } from "./common.schema";

/** Loại phim — nằm ở đây (không lấy từ `@prisma/client`) để giao diện phía trình duyệt dùng lại được. */
export const MOVIE_TYPES = ["SINGLE", "SERIES", "THEATRICAL"] as const;
export type MovieType = (typeof MOVIE_TYPES)[number];
export const movieTypeSchema = z.enum(MOVIE_TYPES);

export const MOVIE_TYPE_LABELS: Record<MovieType, string> = {
  SINGLE: "Phim lẻ",
  SERIES: "Phim bộ",
  THEATRICAL: "Chiếu rạp",
};

export const listMoviesSchema = paginationSchema.extend({
  /** Tìm theo tên phim. */
  q: emptyToUndefined(z.string().trim().max(100).optional()),
  type: emptyToUndefined(movieTypeSchema.optional()),
  /** Slug thể loại. */
  genre: emptyToUndefined(z.string().trim().max(100).optional()),
});
export type ListMoviesInput = z.infer<typeof listMoviesSchema>;

/** Phần thông tin chung của phim — dùng cho cả tạo lẫn sửa. */
const movieInfoSchema = z.object({
  title: z.string().trim().min(1, "Tên phim không được trống").max(200),
  description: emptyToUndefined(z.string().trim().max(5000).optional()),
  releaseYear: emptyToUndefined(
    z.coerce.number().int().min(1888, "Năm không hợp lệ").max(2100, "Năm không hợp lệ").optional(),
  ),
  type: movieTypeSchema,
  genreIds: z.array(z.string().min(1)).max(20).default([]),
});

/**
 * Tạo phim kèm TẬP ĐẦU TIÊN, từ id các tệp ĐÃ tải lên (video bắt buộc, poster tuỳ chọn) — gửi `id`
 * của tệp, không gửi URL. `movieService.create` gắn tệp trong cùng transaction.
 */
export const createMovieSchema = movieInfoSchema.extend({
  videoFileId: z.string().min(1, "Chưa tải video lên"),
  posterFileId: emptyToUndefined(z.string().optional()),
  episodeTitle: emptyToUndefined(z.string().trim().max(200).optional()),
});
export type CreateMovieInput = z.infer<typeof createMovieSchema>;

/** Sửa thông tin phim. `posterFileId` có mặt = thay poster mới; bỏ trống = giữ poster cũ. */
export const updateMovieSchema = movieInfoSchema.extend({
  posterFileId: emptyToUndefined(z.string().optional()),
});
export type UpdateMovieInput = z.infer<typeof updateMovieSchema>;

/** Thêm tập mới vào phim bộ. Số tập do máy chủ tự đánh (lớn nhất + 1). */
export const addEpisodeSchema = z.object({
  videoFileId: z.string().min(1, "Chưa tải video lên"),
  title: emptyToUndefined(z.string().trim().max(200).optional()),
});
export type AddEpisodeInput = z.infer<typeof addEpisodeSchema>;

export const createGenreSchema = z.object({
  name: z.string().trim().min(1, "Tên thể loại không được trống").max(50),
});
export type CreateGenreInput = z.infer<typeof createGenreSchema>;

/** Xuất bản / ẩn phim. */
export const setMoviePublishedSchema = z.object({ published: z.boolean() });
export type SetMoviePublishedInput = z.infer<typeof setMoviePublishedSchema>;

/**
 * Query của `GET /api/v1/movies`. `includeUnpublished=true` chỉ có tác dụng với `movie:manage` —
 * người thường gửi lên cũng chỉ thấy phim đã xuất bản.
 */
export const listMoviesQuerySchema = listMoviesSchema.extend({
  includeUnpublished: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

/** Query của `GET /api/v1/movies/{id}`: `ep` = số tập muốn phát, bỏ trống = tập đầu. */
export const watchMovieQuerySchema = z.object({
  ep: emptyToUndefined(z.coerce.number().int().positive().optional()),
});

/**
 * Trình phát báo vị trí đang xem. Gửi định kỳ khi đang phát, khi tạm dừng và khi rời trang — chỉ
 * ghi đè đúng một dòng cho mỗi (người, phim), nên gửi dày cũng không phình bảng.
 */
export const saveWatchProgressSchema = z.object({
  episodeId: z.string().min(1),
  positionSeconds: z
    .number()
    .int()
    .min(0)
    .max(24 * 3600),
  durationSeconds: z
    .number()
    .int()
    .positive()
    .max(24 * 3600),
});
export type SaveWatchProgressInput = z.infer<typeof saveWatchProgressSchema>;

export const listWatchHistorySchema = paginationSchema;
export type ListWatchHistoryInput = z.infer<typeof listWatchHistorySchema>;
