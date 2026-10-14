import type { PrismaClient } from "@prisma/client";
import { GenreAlreadyExistsError, GenreNotFoundError } from "@/lib/errors";
import { slugify } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import type { CreateGenreInput } from "@/schemas/movie.schema";
import type { GenreSummary } from "./movie.service";

/** Thể loại phim. Danh sách ngắn, đổi ít — không phân trang. */
export class GenreService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async list(): Promise<GenreSummary[]> {
    return this.db.genre.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true },
    });
  }

  /** Slug sinh từ tên (bỏ dấu) — dùng trên URL lọc `?genre=hanh-dong`. Trùng tên hoặc slug thì 409. */
  async create(input: CreateGenreInput): Promise<GenreSummary> {
    const slug = slugify(input.name);
    try {
      return await this.db.genre.create({
        data: { name: input.name, slug },
        select: { id: true, name: true, slug: true },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw new GenreAlreadyExistsError();
      throw error;
    }
  }

  /** Xoá thể loại — chỉ gỡ khỏi các phim (bảng nối xoá theo), không đụng tới phim. */
  async remove(id: string): Promise<void> {
    const { count } = await this.db.genre.deleteMany({ where: { id } });
    if (count === 0) throw new GenreNotFoundError();
  }
}

export const genreService = new GenreService();
