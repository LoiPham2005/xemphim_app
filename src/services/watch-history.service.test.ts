import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { EpisodeNotFoundError } from "@/lib/errors";
import type * as StorageModule from "@/lib/storage";

vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof StorageModule>()),
  getStorage: () => ({ url: (key: string) => `https://cdn.test/${key}` }),
}));

const { WatchHistoryService, isFinished, resumeTarget } = await import("./watch-history.service");

const ROW = {
  id: "h1",
  userId: "u1",
  movieId: "m1",
  episodeId: "e2",
  positionSeconds: 600,
  durationSeconds: 2400,
  createdAt: new Date("2026-10-14T00:00:00Z"),
  updatedAt: new Date("2026-10-14T01:00:00Z"),
  episode: { id: "e2", movieId: "m1", number: 2, title: "Qua sông" as string | null },
  movie: {
    id: "m1",
    title: "Phim bộ",
    description: null,
    releaseYear: 2025,
    type: "SERIES",
    published: true,
    posterFileId: null,
    poster: null,
    genres: [],
    _count: { episodes: 3 },
    episodes: [{ number: 1 }, { number: 3 }, { number: 2 }],
    createdAt: new Date("2026-10-14T00:00:00Z"),
    updatedAt: new Date("2026-10-14T00:00:00Z"),
  },
};

function createDb(row: Partial<typeof ROW> | null = ROW) {
  const value = row === null ? null : { ...ROW, ...row };
  const db = {
    episode: { findFirst: vi.fn().mockResolvedValue({ id: "e2", movieId: "m1" }) },
    watchHistory: {
      upsert: vi.fn().mockResolvedValue(value),
      findMany: vi.fn().mockResolvedValue(value ? [value] : []),
      findUnique: vi.fn().mockResolvedValue(value),
      count: vi.fn().mockResolvedValue(value ? 1 : 0),
      deleteMany: vi.fn().mockResolvedValue({ count: 4 }),
    },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  };
  return db;
}

const service = (db = createDb()) => new WatchHistoryService(db as unknown as PrismaClient);
const VIEWER = { includeUnpublished: false };

describe("isFinished / resumeTarget", () => {
  it("còn ≤ 30 giây hoặc đã xem ≥ 95% thì coi là xem xong", () => {
    expect(isFinished(2370, 2400)).toBe(true);
    expect(isFinished(96, 100)).toBe(true);
    expect(isFinished(600, 2400)).toBe(false);
  });

  it("đang dở -> đúng tập, đúng giây", () => {
    const progress = {
      episode: { id: "e2", number: 2, title: null },
      positionSeconds: 600,
      durationSeconds: 2400,
      finished: false,
      nextEpisodeNumber: 3,
      updatedAt: new Date(),
    };
    expect(resumeTarget(progress)).toEqual({ episodeNumber: 2, positionSeconds: 600 });
  });

  it("xem xong và còn tập sau -> tập sau từ đầu; xong tập cuối -> xem lại tập đó", () => {
    const base = {
      episode: { id: "e2", number: 2, title: null },
      positionSeconds: 2390,
      durationSeconds: 2400,
      finished: true,
      updatedAt: new Date(),
    };
    expect(resumeTarget({ ...base, nextEpisodeNumber: 3 })).toEqual({
      episodeNumber: 3,
      positionSeconds: 0,
    });
    expect(resumeTarget({ ...base, nextEpisodeNumber: null })).toEqual({
      episodeNumber: 2,
      positionSeconds: 0,
    });
  });

  it("chưa xem bao giờ -> null", () => {
    expect(resumeTarget(null)).toBeNull();
  });
});

describe("WatchHistoryService.saveProgress", () => {
  it("ghi đè MỘT dòng theo (người, phim), vị trí không vượt thời lượng", async () => {
    const db = createDb();
    await service(db).saveProgress(
      "u1",
      { episodeId: "e2", positionSeconds: 9999, durationSeconds: 2400 },
      VIEWER,
    );

    expect(db.watchHistory.upsert).toHaveBeenCalledWith({
      where: { userId_movieId: { userId: "u1", movieId: "m1" } },
      create: {
        userId: "u1",
        movieId: "m1",
        episodeId: "e2",
        positionSeconds: 2400,
        durationSeconds: 2400,
      },
      update: { episodeId: "e2", positionSeconds: 2400, durationSeconds: 2400 },
    });
  });

  it("người thường chỉ ghi được cho phim ĐÃ xuất bản (điều kiện trong truy vấn)", async () => {
    const db = createDb();
    await service(db).saveProgress(
      "u1",
      { episodeId: "e2", positionSeconds: 1, durationSeconds: 2 },
      VIEWER,
    );

    const { where } = db.episode.findFirst.mock.calls[0]?.[0] as { where: object };
    expect(where).toEqual({ id: "e2", movie: { published: true } });
  });

  it("tập không tồn tại / không được xem -> 404, không ghi gì", async () => {
    const db = createDb();
    db.episode.findFirst.mockResolvedValueOnce(null);

    await expect(
      service(db).saveProgress(
        "u1",
        { episodeId: "x", positionSeconds: 1, durationSeconds: 2 },
        VIEWER,
      ),
    ).rejects.toBeInstanceOf(EpisodeNotFoundError);
    expect(db.watchHistory.upsert).not.toHaveBeenCalled();
  });
});

describe("WatchHistoryService.list / getProgress", () => {
  it("chỉ lịch sử của chính người hỏi, phim đã xuất bản, mới nhất trước", async () => {
    const db = createDb();
    const { items, meta } = await service(db).list("u1", { page: 1, limit: 20 }, VIEWER);

    const args = db.watchHistory.findMany.mock.calls[0]?.[0] as {
      where: object;
      orderBy: object;
    };
    expect(args.where).toEqual({ userId: "u1", movie: { published: true } });
    expect(args.orderBy).toEqual({ updatedAt: "desc" });
    expect(meta.total).toBe(1);
    expect(items[0]).toMatchObject({
      movie: { id: "m1", episodeCount: 3 },
      episode: { number: 2 },
      positionSeconds: 600,
      finished: false,
      nextEpisodeNumber: 3,
    });
  });

  it("tập cuối -> không có tập kế tiếp", async () => {
    const db = createDb({ episode: { id: "e3", movieId: "m1", number: 3, title: null } });
    const progress = await service(db).getProgress("u1", "m1");

    expect(progress?.nextEpisodeNumber).toBeNull();
    expect(db.watchHistory.findUnique.mock.calls[0]?.[0]).toMatchObject({
      where: { userId_movieId: { userId: "u1", movieId: "m1" } },
    });
  });

  it("chưa xem phim này -> null", async () => {
    expect(await service(createDb(null)).getProgress("u1", "m1")).toBeNull();
  });
});

describe("WatchHistoryService.remove / clear", () => {
  it("xoá ràng cả userId — không xoá được lịch sử của người khác", async () => {
    const db = createDb();
    await service(db).remove("u1", "m1");
    expect(db.watchHistory.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", movieId: "m1" },
    });
  });

  it("xoá hết trả số dòng đã xoá", async () => {
    const db = createDb();
    expect(await service(db).clear("u1")).toBe(4);
    expect(db.watchHistory.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });
});
