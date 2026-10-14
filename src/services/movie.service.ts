import type {
  Episode,
  File as FileRow,
  Genre,
  Movie,
  MovieGenre,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import {
  EpisodeNotFoundError,
  LastEpisodeError,
  MovieNotFoundError,
  SingleEpisodeOnlyError,
  TooManyEpisodesForTypeError,
} from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getStorage } from "@/lib/storage";
import { buildPaginationMeta, toPrismaPage, type Paginated } from "@/schemas/common.schema";
import type {
  AddEpisodeInput,
  CreateMovieInput,
  ListMoviesInput,
  MovieType,
  UpdateMovieInput,
} from "@/schemas/movie.schema";
import { fileService, type FileService } from "./file.service";

/**
 * URL phim/poster sống bao lâu. Dài hơn một bộ phim dài nhất: trình duyệt tải video theo từng đoạn
 * (Range), URL hết hạn giữa chừng thì tua tới đoạn chưa tải là lỗi 403.
 */
const MEDIA_URL_TTL_SECONDS = 6 * 3600;

export type GenreSummary = { id: string; name: string; slug: string };

export type PublicMovie = {
  id: string;
  title: string;
  description: string | null;
  releaseYear: number | null;
  type: MovieType;
  published: boolean;
  posterUrl: string | null;
  genres: GenreSummary[];
  episodeCount: number;
  createdAt: Date;
};

export type EpisodeSummary = { id: string; number: number; title: string | null };

export type WatchableMovie = PublicMovie & {
  episodes: EpisodeSummary[];
  current: EpisodeSummary & { video: { url: string; contentType: string; size: number } };
};

/** Bản cho trang quản trị một phim: thêm dung lượng từng tập để người quản lý biết tập nào lỗi. */
export type ManagedMovie = PublicMovie & {
  episodes: (EpisodeSummary & { size: number; createdAt: Date })[];
};

/** `includeUnpublished` = người xem có `movie:manage` — nơi gọi kiểm quyền rồi mới bật. */
export type MovieViewer = { includeUnpublished: boolean };

const LIST_INCLUDE = {
  poster: true,
  genres: { include: { genre: true }, orderBy: { genre: { name: "asc" } } },
  _count: { select: { episodes: true } },
} satisfies Prisma.MovieInclude;

type MovieListRow = Movie & {
  poster: FileRow | null;
  genres: (MovieGenre & { genre: Genre })[];
  _count: { episodes: number };
};

/**
 * Kho phim. Mỗi phim có một hay nhiều TẬP; mỗi tập trỏ tới một video trong `files`. Phim lẻ và
 * chiếu rạp có đúng 1 tập, phim bộ thêm tập dần bằng `addEpisode`.
 *
 * Tệp gắn bằng `fileService.claim()` trong CÙNG transaction với bản ghi — lỗi giữa chừng thì tệp vẫn
 * mồ côi và `purgeOrphans` dọn sau 24 giờ. Gỡ phim/tập chỉ `release()` tệp, việc xoá trên kho để
 * `purgeOrphans` làm (kho và database không chung transaction được, xem `FileService`).
 *
 * URL trả ra là URL KÝ SẴN có hạn (nếu kho hỗ trợ), nên bucket để riêng tư được.
 */
export class MovieService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly files: Pick<FileService, "claim" | "release"> = fileService,
  ) {}

  // -------------------------------------------------------------------------
  // Xem
  // -------------------------------------------------------------------------

  async list(input: ListMoviesInput, viewer: MovieViewer): Promise<Paginated<PublicMovie>> {
    const where: Prisma.MovieWhereInput = {
      ...(viewer.includeUnpublished ? {} : { published: true }),
      ...(input.q ? { title: { contains: input.q, mode: "insensitive" } } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.genre ? { genres: { some: { genre: { slug: input.genre } } } } : {}),
    };

    const [rows, total] = await this.db.$transaction([
      this.db.movie.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: { updatedAt: "desc" },
        ...toPrismaPage(input),
      }),
      this.db.movie.count({ where }),
    ]);

    return {
      items: await Promise.all(rows.map((row) => toPublicMovie(row))),
      meta: buildPaginationMeta(total, input),
    };
  }

  /**
   * Phim kèm URL phát của MỘT tập (`episodeNumber`, bỏ trống = tập đầu). Chưa xuất bản mà người xem
   * không quản lý được thì 404, không phải 403.
   */
  async getForWatch(
    id: string,
    episodeNumber: number | undefined,
    viewer: MovieViewer,
  ): Promise<WatchableMovie> {
    const row = await this.db.movie.findFirst({
      where: { id, ...(viewer.includeUnpublished ? {} : { published: true }) },
      include: {
        ...LIST_INCLUDE,
        episodes: { orderBy: { number: "asc" }, include: { video: true } },
      },
    });
    if (!row) throw new MovieNotFoundError();

    const episode =
      episodeNumber === undefined
        ? row.episodes[0]
        : row.episodes.find((item) => item.number === episodeNumber);
    if (!episode) throw new EpisodeNotFoundError();

    return {
      ...(await toPublicMovie(row)),
      episodes: row.episodes.map(toEpisodeSummary),
      current: {
        ...toEpisodeSummary(episode),
        video: {
          url: await mediaUrl(episode.video.key),
          contentType: episode.video.mimeType,
          size: Number(episode.video.size),
        },
      },
    };
  }

  /** Cho trang quản trị một phim — luôn thấy cả phim đang ẩn. */
  async getForManage(id: string): Promise<ManagedMovie> {
    const row = await this.db.movie.findUnique({
      where: { id },
      include: {
        ...LIST_INCLUDE,
        episodes: { orderBy: { number: "asc" }, include: { video: true } },
      },
    });
    if (!row) throw new MovieNotFoundError();

    return {
      ...(await toPublicMovie(row)),
      episodes: row.episodes.map((episode) => ({
        ...toEpisodeSummary(episode),
        size: Number(episode.video.size),
        createdAt: episode.createdAt,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Quản lý
  // -------------------------------------------------------------------------

  /**
   * Tạo phim kèm TẬP 1, ở trạng thái CHƯA xuất bản — người quản lý xem thử rồi mới bật. Video và
   * poster phải do chính `actorId` tải lên, đúng loại, và chưa gắn ở đâu (`claim` kiểm).
   */
  async create(input: CreateMovieInput, actorId: string): Promise<PublicMovie> {
    const row = await this.db.$transaction(async (tx) => {
      await this.files.claim(tx, input.videoFileId, {
        field: "videoFileId",
        ownerIds: [actorId],
        mimePrefix: "video/",
      });
      if (input.posterFileId) {
        await this.files.claim(tx, input.posterFileId, {
          field: "posterFileId",
          ownerIds: [actorId],
          mimePrefix: "image/",
        });
      }

      return tx.movie.create({
        data: {
          title: input.title,
          description: input.description ?? null,
          releaseYear: input.releaseYear ?? null,
          type: input.type,
          posterFileId: input.posterFileId ?? null,
          genres: { create: input.genreIds.map((genreId) => ({ genreId })) },
          episodes: {
            create: {
              number: 1,
              title: input.episodeTitle ?? null,
              videoFileId: input.videoFileId,
            },
          },
        },
        include: LIST_INCLUDE,
      });
    });

    return toPublicMovie(row);
  }

  /**
   * Sửa thông tin phim. Thay poster = gắn poster mới + gỡ poster cũ trong cùng transaction. Đổi phim bộ
   * đang có nhiều tập sang phim lẻ/chiếu rạp thì từ chối — sẽ phá luật "1 tập".
   */
  async update(id: string, input: UpdateMovieInput, actorId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const movie = await tx.movie.findUnique({
        where: { id },
        include: { _count: { select: { episodes: true } } },
      });
      if (!movie) throw new MovieNotFoundError();
      if (input.type !== "SERIES" && movie._count.episodes > 1) {
        throw new TooManyEpisodesForTypeError();
      }

      const replacePoster =
        input.posterFileId !== undefined && input.posterFileId !== movie.posterFileId;
      if (replacePoster && input.posterFileId) {
        await this.files.claim(tx, input.posterFileId, {
          field: "posterFileId",
          ownerIds: [actorId],
          mimePrefix: "image/",
        });
        if (movie.posterFileId) await this.files.release(tx, movie.posterFileId);
      }

      await tx.movie.update({
        where: { id },
        data: {
          title: input.title,
          description: input.description ?? null,
          releaseYear: input.releaseYear ?? null,
          type: input.type,
          ...(replacePoster ? { posterFileId: input.posterFileId } : {}),
          genres: { deleteMany: {}, create: input.genreIds.map((genreId) => ({ genreId })) },
        },
      });
    });
  }

  /**
   * Thêm tập vào phim bộ, số tập = lớn nhất + 1. Ràng buộc `@@unique([movieId, number])` chặn hai
   * request cùng lúc ra hai "Tập 5" — bên thua nhận lỗi và thử lại.
   *
   * Thêm tập cũng đẩy phim lên đầu danh sách ("Mới cập nhật"), vì danh sách xếp theo `updatedAt`.
   */
  async addEpisode(
    movieId: string,
    input: AddEpisodeInput,
    actorId: string,
  ): Promise<EpisodeSummary> {
    return this.db.$transaction(async (tx) => {
      const movie = await tx.movie.findUnique({
        where: { id: movieId },
        include: { _count: { select: { episodes: true } } },
      });
      if (!movie) throw new MovieNotFoundError();
      if (movie.type !== "SERIES" && movie._count.episodes >= 1) {
        throw new SingleEpisodeOnlyError();
      }

      await this.files.claim(tx, input.videoFileId, {
        field: "videoFileId",
        ownerIds: [actorId],
        mimePrefix: "video/",
      });

      const last = await tx.episode.findFirst({
        where: { movieId },
        orderBy: { number: "desc" },
        select: { number: true },
      });
      const episode = await tx.episode.create({
        data: {
          movieId,
          number: (last?.number ?? 0) + 1,
          title: input.title ?? null,
          videoFileId: input.videoFileId,
        },
      });
      await tx.movie.update({ where: { id: movieId }, data: { updatedAt: new Date() } });

      return toEpisodeSummary(episode);
    });
  }

  /** Xoá một tập và gỡ video của nó. Không xoá tập duy nhất còn lại — xoá cả phim thay vào. */
  async removeEpisode(episodeId: string): Promise<{ movieId: string }> {
    return this.db.$transaction(async (tx) => {
      const episode = await tx.episode.findUnique({ where: { id: episodeId } });
      if (!episode) throw new EpisodeNotFoundError();

      const count = await tx.episode.count({ where: { movieId: episode.movieId } });
      if (count <= 1) throw new LastEpisodeError();

      await tx.episode.delete({ where: { id: episodeId } });
      await this.files.release(tx, episode.videoFileId);
      return { movieId: episode.movieId };
    });
  }

  async setPublished(id: string, published: boolean): Promise<void> {
    const { count } = await this.db.movie.updateMany({ where: { id }, data: { published } });
    if (count === 0) throw new MovieNotFoundError();
  }

  /** Xoá phim (các tập xoá theo nhờ `onDelete: Cascade`) và GỠ mọi video + poster để purge dọn trên kho. */
  async remove(id: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const movie = await tx.movie.findUnique({
        where: { id },
        include: { episodes: { select: { videoFileId: true } } },
      });
      if (!movie) throw new MovieNotFoundError();

      await tx.movie.delete({ where: { id } });
      for (const episode of movie.episodes) await this.files.release(tx, episode.videoFileId);
      if (movie.posterFileId) await this.files.release(tx, movie.posterFileId);
    });
  }
}

/** URL ký sẵn nếu kho hỗ trợ (S3), không thì URL thường (đĩa cục bộ ở dev). */
async function mediaUrl(key: string): Promise<string> {
  const storage = getStorage();
  return (await storage.signedUrl?.(key, MEDIA_URL_TTL_SECONDS)) ?? storage.url(key);
}

function toEpisodeSummary(episode: Episode): EpisodeSummary {
  return { id: episode.id, number: episode.number, title: episode.title };
}

async function toPublicMovie(row: MovieListRow): Promise<PublicMovie> {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    releaseYear: row.releaseYear,
    type: row.type,
    published: row.published,
    posterUrl: row.poster ? await mediaUrl(row.poster.key) : null,
    genres: row.genres.map(({ genre }) => ({ id: genre.id, name: genre.name, slug: genre.slug })),
    episodeCount: row._count.episodes,
    createdAt: row.createdAt,
  };
}

export const movieService = new MovieService();
