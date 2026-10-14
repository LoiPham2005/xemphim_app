import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  EpisodeNotFoundError,
  FileNotUsableError,
  LastEpisodeError,
  MovieNotFoundError,
  SingleEpisodeOnlyError,
  TooManyEpisodesForTypeError,
} from "@/lib/errors";
import type * as StorageModule from "@/lib/storage";

const storage = vi.hoisted(() => ({
  url: (key: string) => `https://cdn.test/${key}`,
  signedUrl: vi.fn() as ReturnType<typeof vi.fn> | undefined,
}));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof StorageModule>()),
  getStorage: () => storage,
}));

const { MovieService } = await import("./movie.service");

const video = (n: number) => ({
  id: `v${n}`,
  key: `movies/${n}.mp4`,
  mimeType: "video/mp4",
  size: 3_000_000_000n,
});
const episode = (n: number) => ({
  id: `e${n}`,
  movieId: "m1",
  number: n,
  title: null,
  videoFileId: `v${n}`,
  video: video(n),
  createdAt: new Date("2026-10-14T00:00:00Z"),
});
const POSTER = { id: "p1", key: "posters/1.png", mimeType: "image/png", size: 1000n };
const MOVIE = {
  id: "m1",
  title: "Phim A",
  description: null,
  releaseYear: 2024,
  type: "SERIES" as "SINGLE" | "SERIES" | "THEATRICAL",
  published: true,
  posterFileId: "p1" as string | null,
  poster: POSTER as typeof POSTER | null,
  genres: [
    { movieId: "m1", genreId: "g1", genre: { id: "g1", name: "Hành động", slug: "hanh-dong" } },
  ],
  episodes: [episode(1), episode(2)],
  _count: { episodes: 2 },
  createdAt: new Date("2026-10-14T00:00:00Z"),
  updatedAt: new Date("2026-10-14T00:00:00Z"),
};

function createDb(movie: Partial<typeof MOVIE> | null = MOVIE) {
  const row = movie === null ? null : { ...MOVIE, ...movie };
  const lastEpisode = row?.episodes.at(-1) ?? null;
  const db = {
    movie: {
      findMany: vi.fn().mockResolvedValue(row ? [row] : []),
      findFirst: vi.fn().mockResolvedValue(row),
      findUnique: vi.fn().mockResolvedValue(row),
      count: vi.fn().mockResolvedValue(row ? 1 : 0),
      // Prisma trả bản ghi đã nối (genres/episodes là mảng), không phải `data` thô kiểu `{ connect }`.
      create: vi.fn(({ data }: { data: { title: string } }) =>
        Promise.resolve({ ...MOVIE, title: data.title }),
      ),
      update: vi.fn().mockResolvedValue(row),
      updateMany: vi.fn().mockResolvedValue({ count: row ? 1 : 0 }),
      delete: vi.fn().mockResolvedValue(row),
    },
    episode: {
      findUnique: vi.fn().mockResolvedValue(row?.episodes[0] ?? null),
      findFirst: vi.fn().mockResolvedValue(lastEpisode),
      count: vi.fn().mockResolvedValue(row?.episodes.length ?? 0),
      create: vi.fn(({ data }: { data: object }) =>
        Promise.resolve({ id: "new", title: null, ...data }),
      ),
      delete: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === "function" ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as []),
    ),
  };
  return db;
}

function createFiles() {
  return {
    claim: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
  };
}

function service(db = createDb(), files = createFiles()) {
  return new MovieService(db as unknown as PrismaClient, files);
}

const INFO = { title: "Phim B", type: "SERIES" as const, genreIds: ["g1"] };

beforeEach(() => {
  storage.signedUrl = vi.fn((key: string) => Promise.resolve(`https://signed.test/${key}`));
});

describe("MovieService.list", () => {
  it("người xem thường chỉ thấy phim đã xuất bản", async () => {
    const db = createDb();
    await service(db).list({ page: 1, limit: 20 }, { includeUnpublished: false });

    const { where } = db.movie.findMany.mock.calls[0]?.[0] as { where: { published?: boolean } };
    expect(where.published).toBe(true);
  });

  it("lọc theo tên, loại và thể loại (slug); người quản lý thấy cả phim ẩn", async () => {
    const db = createDb();
    await service(db).list(
      { page: 1, limit: 20, q: "phim", type: "SERIES", genre: "hanh-dong" },
      { includeUnpublished: true },
    );

    const { where } = db.movie.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(where.published).toBeUndefined();
    expect(where.title).toEqual({ contains: "phim", mode: "insensitive" });
    expect(where.type).toBe("SERIES");
    expect(where.genres).toEqual({ some: { genre: { slug: "hanh-dong" } } });
  });

  it("trả loại, thể loại, số tập và poster URL KÝ SẴN", async () => {
    const { items, meta } = await service().list(
      { page: 1, limit: 20 },
      { includeUnpublished: false },
    );

    expect(items[0]).toMatchObject({
      type: "SERIES",
      episodeCount: 2,
      genres: [{ id: "g1", name: "Hành động", slug: "hanh-dong" }],
      posterUrl: "https://signed.test/posters/1.png",
    });
    expect(meta.total).toBe(1);
  });

  it("kho không ký được (đĩa cục bộ) thì dùng URL thường", async () => {
    storage.signedUrl = undefined;
    const { items } = await service().list({ page: 1, limit: 20 }, { includeUnpublished: false });

    expect(items[0]?.posterUrl).toBe("https://cdn.test/posters/1.png");
  });
});

describe("MovieService.getForWatch", () => {
  it("không chỉ định tập -> phát tập đầu, kèm danh sách tập", async () => {
    const movie = await service().getForWatch("m1", undefined, { includeUnpublished: false });

    expect(movie.current.number).toBe(1);
    expect(movie.episodes.map((item) => item.number)).toEqual([1, 2]);
    expect(movie.current.video).toEqual({
      url: "https://signed.test/movies/1.mp4",
      contentType: "video/mp4",
      size: 3_000_000_000,
    });
    expect(storage.signedUrl).toHaveBeenCalledWith("movies/1.mp4", 6 * 3600);
  });

  it("chọn tập 2 -> phát đúng video tập 2", async () => {
    const movie = await service().getForWatch("m1", 2, { includeUnpublished: false });

    expect(movie.current.video.url).toBe("https://signed.test/movies/2.mp4");
  });

  it("tập không tồn tại -> 404 tập", async () => {
    await expect(
      service().getForWatch("m1", 9, { includeUnpublished: false }),
    ).rejects.toBeInstanceOf(EpisodeNotFoundError);
  });

  it("phim chưa xuất bản -> 404 với người xem thường (điều kiện nằm trong truy vấn)", async () => {
    const db = createDb(null);

    await expect(
      service(db).getForWatch("m1", undefined, { includeUnpublished: false }),
    ).rejects.toBeInstanceOf(MovieNotFoundError);
    const { where } = db.movie.findFirst.mock.calls[0]?.[0] as { where: object };
    expect(where).toEqual({ id: "m1", published: true });
  });
});

describe("MovieService.getForManage", () => {
  it("trả từng tập kèm dung lượng", async () => {
    const movie = await service().getForManage("m1");
    expect(movie.episodes[1]).toMatchObject({ number: 2, size: 3_000_000_000 });
  });

  it("không tồn tại -> 404", async () => {
    await expect(service(createDb(null)).getForManage("x")).rejects.toBeInstanceOf(
      MovieNotFoundError,
    );
  });
});

describe("MovieService.create", () => {
  const INPUT = { ...INFO, videoFileId: "v1", posterFileId: "p1", episodeTitle: "Mở đầu" };

  it("gắn video và poster TRONG transaction, tạo tập 1, nối thể loại", async () => {
    const db = createDb();
    const files = createFiles();
    await service(db, files).create(INPUT, "admin");

    expect(files.claim).toHaveBeenCalledWith(db, "v1", {
      field: "videoFileId",
      ownerIds: ["admin"],
      mimePrefix: "video/",
    });
    expect(files.claim).toHaveBeenCalledWith(db, "p1", {
      field: "posterFileId",
      ownerIds: ["admin"],
      mimePrefix: "image/",
    });
    const { data } = db.movie.create.mock.calls[0]?.[0] as unknown as {
      data: { published?: boolean; type: string; genres: object; episodes: object };
    };
    expect(data.type).toBe("SERIES");
    expect(data.genres).toEqual({ create: [{ genreId: "g1" }] });
    expect(data.episodes).toEqual({
      create: { number: 1, title: "Mở đầu", videoFileId: "v1" },
    });
    // Phim mới mặc định ẩn (default của schema) — không tự xuất bản.
    expect(data.published).toBeUndefined();
  });

  it("không có poster thì không gắn poster", async () => {
    const files = createFiles();
    await service(createDb(), files).create({ ...INFO, videoFileId: "v1" }, "admin");

    expect(files.claim).toHaveBeenCalledTimes(1);
  });

  it("video không dùng được -> lỗi bung ra, không tạo phim", async () => {
    const db = createDb();
    const files = createFiles();
    files.claim.mockRejectedValueOnce(new FileNotUsableError("videoFileId"));

    await expect(service(db, files).create(INPUT, "admin")).rejects.toBeInstanceOf(
      FileNotUsableError,
    );
    expect(db.movie.create).not.toHaveBeenCalled();
  });
});

describe("MovieService.update", () => {
  it("thay poster: gắn poster mới, gỡ poster cũ, đặt lại thể loại", async () => {
    const db = createDb();
    const files = createFiles();
    await service(db, files).update("m1", { ...INFO, posterFileId: "p2" }, "admin");

    expect(files.claim).toHaveBeenCalledWith(
      db,
      "p2",
      expect.objectContaining({ mimePrefix: "image/" }),
    );
    expect(files.release).toHaveBeenCalledWith(db, "p1");
    const { data } = db.movie.update.mock.calls[0]?.[0] as {
      data: { posterFileId?: string; genres: object };
    };
    expect(data.posterFileId).toBe("p2");
    expect(data.genres).toEqual({ deleteMany: {}, create: [{ genreId: "g1" }] });
  });

  it("không gửi poster -> giữ poster cũ, không gắn/gỡ gì", async () => {
    const db = createDb();
    const files = createFiles();
    await service(db, files).update("m1", INFO, "admin");

    expect(files.claim).not.toHaveBeenCalled();
    expect(files.release).not.toHaveBeenCalled();
    const { data } = db.movie.update.mock.calls[0]?.[0] as { data: object };
    expect(data).not.toHaveProperty("posterFileId");
  });

  it("đổi phim bộ NHIỀU tập sang phim lẻ -> từ chối", async () => {
    const db = createDb();
    await expect(
      service(db).update("m1", { ...INFO, type: "SINGLE" }, "admin"),
    ).rejects.toBeInstanceOf(TooManyEpisodesForTypeError);
    expect(db.movie.update).not.toHaveBeenCalled();
  });

  it("phim không tồn tại -> 404", async () => {
    await expect(service(createDb(null)).update("x", INFO, "admin")).rejects.toBeInstanceOf(
      MovieNotFoundError,
    );
  });
});

describe("MovieService.addEpisode", () => {
  it("phim bộ: tập mới = số lớn nhất + 1, gắn video, đẩy phim lên 'mới cập nhật'", async () => {
    const db = createDb();
    const files = createFiles();
    const added = await service(db, files).addEpisode(
      "m1",
      { videoFileId: "v3", title: "Kết" },
      "admin",
    );

    expect(added.number).toBe(3);
    expect(files.claim).toHaveBeenCalledWith(
      db,
      "v3",
      expect.objectContaining({ mimePrefix: "video/" }),
    );
    expect(db.movie.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it("phim lẻ đã có 1 tập -> từ chối, không gắn video", async () => {
    const files = createFiles();
    await expect(
      service(createDb({ type: "SINGLE", _count: { episodes: 1 } }), files).addEpisode(
        "m1",
        { videoFileId: "v3" },
        "admin",
      ),
    ).rejects.toBeInstanceOf(SingleEpisodeOnlyError);
    expect(files.claim).not.toHaveBeenCalled();
  });

  it("phim không tồn tại -> 404", async () => {
    await expect(
      service(createDb(null)).addEpisode("x", { videoFileId: "v3" }, "admin"),
    ).rejects.toBeInstanceOf(MovieNotFoundError);
  });
});

describe("MovieService.removeEpisode", () => {
  it("xoá tập và gỡ video của tập đó", async () => {
    const db = createDb();
    const files = createFiles();
    const result = await service(db, files).removeEpisode("e1");

    expect(result).toEqual({ movieId: "m1" });
    expect(db.episode.delete).toHaveBeenCalledWith({ where: { id: "e1" } });
    expect(files.release).toHaveBeenCalledWith(db, "v1");
  });

  it("tập duy nhất còn lại -> từ chối", async () => {
    const db = createDb({ episodes: [episode(1)] });
    await expect(service(db).removeEpisode("e1")).rejects.toBeInstanceOf(LastEpisodeError);
    expect(db.episode.delete).not.toHaveBeenCalled();
  });

  it("tập không tồn tại -> 404", async () => {
    const db = createDb();
    db.episode.findUnique.mockResolvedValueOnce(null);
    await expect(service(db).removeEpisode("x")).rejects.toBeInstanceOf(EpisodeNotFoundError);
  });
});

describe("MovieService.setPublished / remove", () => {
  it("đổi trạng thái phim không tồn tại -> 404", async () => {
    await expect(service(createDb(null)).setPublished("x", true)).rejects.toBeInstanceOf(
      MovieNotFoundError,
    );
  });

  it("xoá phim gỡ video MỌI tập lẫn poster để purge dọn trên kho", async () => {
    const db = createDb();
    const files = createFiles();
    await service(db, files).remove("m1");

    expect(db.movie.delete).toHaveBeenCalledWith({ where: { id: "m1" } });
    expect(files.release).toHaveBeenCalledWith(db, "v1");
    expect(files.release).toHaveBeenCalledWith(db, "v2");
    expect(files.release).toHaveBeenCalledWith(db, "p1");
  });

  it("phim không có poster thì chỉ gỡ video", async () => {
    const files = createFiles();
    await service(createDb({ posterFileId: null, poster: null }), files).remove("m1");

    expect(files.release).toHaveBeenCalledTimes(2);
  });

  it("xoá phim không tồn tại -> 404, không gỡ gì", async () => {
    const files = createFiles();
    await expect(service(createDb(null), files).remove("x")).rejects.toBeInstanceOf(
      MovieNotFoundError,
    );
    expect(files.release).not.toHaveBeenCalled();
  });
});
