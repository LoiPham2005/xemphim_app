import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type DatabaseHealth = {
  status: "up" | "down";
  /** Thời gian ping, ms. `null` khi không kết nối được. */
  latencyMs: number | null;
};

/**
 * Kiểm tra database còn sống không.
 *
 * Tách thành service thay vì gọi thẳng Prisma trong route handler — không phải
 * vì một câu `SELECT 1` cần trừu tượng hoá, mà vì ngoại lệ là thứ tự nhân lên.
 * Một route được phép chạm Prisma thì route thứ hai cũng sẽ được, rồi tới lúc
 * không ai nhớ ranh giới nằm ở đâu nữa.
 */
export class HealthService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async checkDatabase(): Promise<DatabaseHealth> {
    const startedAt = Date.now();

    try {
      // `SELECT 1` chứ không phải `count()` trên một bảng: nó không đụng dữ
      // liệu, không khoá gì, và không chậm đi khi bảng lớn dần.
      await this.db.$queryRaw`SELECT 1`;
      return { status: "up", latencyMs: Date.now() - startedAt };
    } catch {
      // Nuốt lỗi có chủ đích: health check phải TRẢ LỜI được ngay cả khi
      // database chết, nếu không load balancer chỉ thấy timeout và không phân
      // biệt được "app chết" với "database chết".
      return { status: "down", latencyMs: null };
    }
  }
}

export const healthService = new HealthService();
