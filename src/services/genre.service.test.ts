import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { GenreAlreadyExistsError, GenreNotFoundError } from "@/lib/errors";
import { GenreService } from "./genre.service";

function createDb() {
  return {
    genre: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(({ data }: { data: object }) => Promise.resolve({ id: "g1", ...data })),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

const service = (db = createDb()) => new GenreService(db as unknown as PrismaClient);

describe("GenreService", () => {
  it("tạo thể loại với slug bỏ dấu để dùng trên URL lọc", async () => {
    const db = createDb();
    const genre = await service(db).create({ name: "Hành động" });

    expect(genre).toEqual({ id: "g1", name: "Hành động", slug: "hanh-dong" });
  });

  it("trùng tên/slug (P2002) -> lỗi 'đã có' báo vào trường name", async () => {
    const db = createDb();
    db.genre.create.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));

    await expect(service(db).create({ name: "Hài" })).rejects.toBeInstanceOf(
      GenreAlreadyExistsError,
    );
  });

  it("lỗi khác thì bung nguyên", async () => {
    const db = createDb();
    db.genre.create.mockRejectedValueOnce(new Error("db down"));

    await expect(service(db).create({ name: "Hài" })).rejects.toThrow("db down");
  });

  it("liệt kê theo tên", async () => {
    const db = createDb();
    await service(db).list();
    expect(db.genre.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { name: "asc" } }),
    );
  });

  it("xoá thể loại không tồn tại -> 404", async () => {
    const db = createDb();
    db.genre.deleteMany.mockResolvedValueOnce({ count: 0 });

    await expect(service(db).remove("x")).rejects.toBeInstanceOf(GenreNotFoundError);
  });
});
