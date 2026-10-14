"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  addEpisodeSchema,
  createGenreSchema,
  createMovieSchema,
  updateMovieSchema,
} from "@/schemas/movie.schema";
import { auditService } from "@/services/audit.service";
import { genreService } from "@/services/genre.service";
import { movieService } from "@/services/movie.service";

type ActionResult = { error?: string };

/**
 * Chạy thao tác, đổi lỗi nghiệp vụ thành câu hiển thị được, lỗi lạ thì log + câu chung chung.
 * Mọi action trong file này đều có cùng một khúc try/catch — gom về một chỗ cho khỏi lệch nhau.
 */
async function run(label: string, task: () => Promise<void>): Promise<ActionResult> {
  try {
    await task();
    return {};
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    logger.error(`${label} thất bại`, error);
    return { error: "Không thực hiện được lúc này. Vui lòng thử lại." };
  }
}

/** Trang chủ và trang quản trị đều hiện danh sách phim — đổi gì cũng làm mới cả hai. */
function revalidateMovies(movieId?: string) {
  revalidatePath("/");
  revalidatePath("/movies");
  if (movieId) revalidatePath(`/movies/${movieId}`);
}

/**
 * Tạo phim kèm tập 1 từ id các tệp đã tải lên. Bản thân tệp KHÔNG đi qua Server Action (giới hạn
 * 1MB) — client tải video thẳng lên kho qua REST `/api/v1/files*` trước, rồi mới gọi action này.
 */
export const createMovieAction = defineAction(
  "movie:manage",
  async (ctx, input: unknown): Promise<ActionResult> => {
    const parsed = createMovieSchema.safeParse(input);
    if (!parsed.success)
      return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

    const result = await run("Tạo phim", async () => {
      const movie = await movieService.create(parsed.data, ctx.actorId);
      await auditService.record({
        action: "movie.created",
        entity: "movie",
        entityId: movie.id,
        actorId: ctx.actorId,
        actorEmail: ctx.session.email,
      });
    });
    if (!result.error) revalidateMovies();
    return result;
  },
);

export const updateMovieAction = defineAction(
  "movie:manage",
  async (ctx, id: string, input: unknown): Promise<ActionResult> => {
    const parsed = updateMovieSchema.safeParse(input);
    if (!parsed.success)
      return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

    const result = await run("Sửa phim", async () => {
      await movieService.update(id, parsed.data, ctx.actorId);
      await auditService.record({
        action: "movie.updated",
        entity: "movie",
        entityId: id,
        actorId: ctx.actorId,
        actorEmail: ctx.session.email,
      });
    });
    if (!result.error) revalidateMovies(id);
    return result;
  },
);

/** Thêm tập tiếp theo cho phim bộ — video đã được client tải thẳng lên kho trước đó. */
export const addEpisodeAction = defineAction(
  "movie:manage",
  async (ctx, movieId: string, input: unknown): Promise<ActionResult> => {
    const parsed = addEpisodeSchema.safeParse(input);
    if (!parsed.success)
      return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

    const result = await run("Thêm tập", async () => {
      const episode = await movieService.addEpisode(movieId, parsed.data, ctx.actorId);
      await auditService.record({
        action: "movie.episode_added",
        entity: "movie",
        entityId: movieId,
        actorId: ctx.actorId,
        actorEmail: ctx.session.email,
        metadata: { episodeId: episode.id, number: episode.number },
      });
    });
    if (!result.error) revalidateMovies(movieId);
    return result;
  },
);

export const deleteEpisodeAction = defineAction(
  "movie:manage",
  async (ctx, episodeId: string): Promise<ActionResult> => {
    let movieId: string | undefined;
    const result = await run("Xoá tập", async () => {
      ({ movieId } = await movieService.removeEpisode(episodeId));
      await auditService.record({
        action: "movie.episode_deleted",
        entity: "movie",
        entityId: movieId,
        actorId: ctx.actorId,
        actorEmail: ctx.session.email,
        metadata: { episodeId },
      });
    });
    if (!result.error) revalidateMovies(movieId);
    return result;
  },
);

export const setMoviePublishedAction = defineAction(
  "movie:manage",
  async (ctx, id: string, published: boolean): Promise<ActionResult> => {
    const result = await run("Đổi trạng thái phim", async () => {
      await movieService.setPublished(id, published === true);
      await auditService.record({
        action: published ? "movie.published" : "movie.unpublished",
        entity: "movie",
        entityId: id,
        actorId: ctx.actorId,
        actorEmail: ctx.session.email,
      });
    });
    if (!result.error) revalidateMovies(id);
    return result;
  },
);

export const deleteMovieAction = defineAction(
  "movie:manage",
  async (ctx, id: string): Promise<ActionResult> => {
    const result = await run("Xoá phim", async () => {
      await movieService.remove(id);
      await auditService.record({
        action: "movie.deleted",
        entity: "movie",
        entityId: id,
        actorId: ctx.actorId,
        actorEmail: ctx.session.email,
      });
    });
    if (!result.error) revalidateMovies();
    return result;
  },
);

export const createGenreAction = defineAction(
  "movie:manage",
  async (_ctx, name: string): Promise<ActionResult> => {
    const parsed = createGenreSchema.safeParse({ name });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Tên không hợp lệ" };

    const result = await run("Thêm thể loại", async () => {
      await genreService.create(parsed.data);
    });
    if (!result.error) revalidateMovies();
    return result;
  },
);

export const deleteGenreAction = defineAction(
  "movie:manage",
  async (_ctx, id: string): Promise<ActionResult> => {
    const result = await run("Xoá thể loại", async () => {
      await genreService.remove(id);
    });
    if (!result.error) revalidateMovies();
    return result;
  },
);
