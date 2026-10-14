import type { Prisma, PrismaClient } from "@prisma/client";
import { EpisodeNotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { buildPaginationMeta, toPrismaPage, type Paginated } from "@/schemas/common.schema";
import type { ListWatchHistoryInput, SaveWatchProgressInput } from "@/schemas/movie.schema";
import {
  LIST_INCLUDE,
  toPublicMovie,
  type EpisodeSummary,
  type MovieViewer,
  type PublicMovie,
} from "./movie.service";

/** Còn ít hơn chừng này giây là coi như xem xong (phần chạy chữ cuối phim). */
const FINISH_REMAINING_SECONDS = 30;
/** ...hoặc đã xem quá tỉ lệ này — cho tập ngắn, nơi 30 giây là một phần lớn. */
const FINISH_RATIO = 0.95;

export type WatchProgress = {
  episode: EpisodeSummary;
  positionSeconds: number;
  durationSeconds: number;
  /** Đã xem gần hết — "Xem tiếp" sẽ chuyển sang tập sau (nếu có) thay vì tua tới đoạn chạy chữ. */
  finished: boolean;
  /** Số tập kế tiếp của phim, `null` nếu đang ở tập cuối. */
  nextEpisodeNumber: number | null;
  updatedAt: Date;
};

export type WatchHistoryItem = WatchProgress & { movie: PublicMovie };

/** Mở phim thì phát tập nào, từ giây thứ mấy. */
export type ResumeTarget = { episodeNumber: number; positionSeconds: number };

export function isFinished(positionSeconds: number, durationSeconds: number): boolean {
  return (
    durationSeconds - positionSeconds <= FINISH_REMAINING_SECONDS ||
    positionSeconds / durationSeconds >= FINISH_RATIO
  );
}

/**
 * Từ tiến độ đã lưu suy ra chỗ phát tiếp: đang dở -> đúng tập, đúng giây; đã xong và còn tập sau ->
 * tập sau từ đầu; đã xong tập cuối -> xem lại tập đó từ đầu. Chưa xem bao giờ -> `null`.
 */
export function resumeTarget(progress: WatchProgress | null): ResumeTarget | null {
  if (!progress) return null;
  if (!progress.finished) {
    return { episodeNumber: progress.episode.number, positionSeconds: progress.positionSeconds };
  }
  if (progress.nextEpisodeNumber !== null) {
    return { episodeNumber: progress.nextEpisodeNumber, positionSeconds: 0 };
  }
  return { episodeNumber: progress.episode.number, positionSeconds: 0 };
}

const HISTORY_INCLUDE = {
  episode: true,
  movie: { include: { ...LIST_INCLUDE, episodes: { select: { number: true } } } },
} satisfies Prisma.WatchHistoryInclude;

type HistoryRow = Prisma.WatchHistoryGetPayload<{ include: typeof HISTORY_INCLUDE }>;

/**
 * Lịch sử xem phim của TỪNG người. Mọi truy vấn đều ràng `userId` ngay trong điều kiện — không có
 * đường nào đọc/xoá lịch sử của người khác.
 */
export class WatchHistoryService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Ghi vị trí đang xem. Tập phải thuộc phim mà người này được xem (phim ẩn chỉ người quản lý) —
   * không thì 404, để không dò được id tập của phim chưa xuất bản.
   */
  async saveProgress(
    userId: string,
    input: SaveWatchProgressInput,
    viewer: MovieViewer,
  ): Promise<void> {
    const episode = await this.db.episode.findFirst({
      where: {
        id: input.episodeId,
        ...(viewer.includeUnpublished ? {} : { movie: { published: true } }),
      },
      select: { id: true, movieId: true },
    });
    if (!episode) throw new EpisodeNotFoundError();

    const data = {
      episodeId: episode.id,
      positionSeconds: Math.min(input.positionSeconds, input.durationSeconds),
      durationSeconds: input.durationSeconds,
    };
    await this.db.watchHistory.upsert({
      where: { userId_movieId: { userId, movieId: episode.movieId } },
      create: { userId, movieId: episode.movieId, ...data },
      update: data,
    });
  }

  /** Lịch sử, xem gần nhất trước. Phim đã bị ẩn thì người thường không còn thấy trong lịch sử. */
  async list(
    userId: string,
    input: ListWatchHistoryInput,
    viewer: MovieViewer,
  ): Promise<Paginated<WatchHistoryItem>> {
    const where: Prisma.WatchHistoryWhereInput = {
      userId,
      ...(viewer.includeUnpublished ? {} : { movie: { published: true } }),
    };

    const [rows, total] = await this.db.$transaction([
      this.db.watchHistory.findMany({
        where,
        include: HISTORY_INCLUDE,
        orderBy: { updatedAt: "desc" },
        ...toPrismaPage(input),
      }),
      this.db.watchHistory.count({ where }),
    ]);

    return {
      items: await Promise.all(
        rows.map(async (row) => ({ ...toProgress(row), movie: await toPublicMovie(row.movie) })),
      ),
      meta: buildPaginationMeta(total, input),
    };
  }

  /** Tiến độ của MỘT phim — trang xem dùng để chọn tập và tua tới chỗ đang dở. */
  async getProgress(userId: string, movieId: string): Promise<WatchProgress | null> {
    const row = await this.db.watchHistory.findUnique({
      where: { userId_movieId: { userId, movieId } },
      include: HISTORY_INCLUDE,
    });
    return row ? toProgress(row) : null;
  }

  /** Xoá một phim khỏi lịch sử. Không có thì thôi — xoá hai lần không phải lỗi. */
  async remove(userId: string, movieId: string): Promise<void> {
    await this.db.watchHistory.deleteMany({ where: { userId, movieId } });
  }

  async clear(userId: string): Promise<number> {
    const { count } = await this.db.watchHistory.deleteMany({ where: { userId } });
    return count;
  }
}

function toProgress(row: HistoryRow): WatchProgress {
  const next = row.movie.episodes
    .map((item) => item.number)
    .filter((number) => number > row.episode.number)
    .sort((a, b) => a - b)[0];

  return {
    episode: { id: row.episode.id, number: row.episode.number, title: row.episode.title },
    positionSeconds: row.positionSeconds,
    durationSeconds: row.durationSeconds,
    finished: isFinished(row.positionSeconds, row.durationSeconds),
    nextEpisodeNumber: next ?? null,
    updatedAt: row.updatedAt,
  };
}

export const watchHistoryService = new WatchHistoryService();
