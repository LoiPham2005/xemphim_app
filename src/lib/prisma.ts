import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { env, isProduction } from "./env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Prisma 7 bỏ query engine viết bằng Rust; kết nối database giờ đi qua driver
 * adapter chạy thuần Node. Đổi lại: image nhẹ hơn, khởi động nhanh hơn, không
 * còn chuyện thiếu binary engine đúng nền tảng.
 *
 * Hệ quả: connection string phải truyền vào ở đây chứ không đọc từ
 * schema.prisma nữa (schema không còn nhận `url`).
 */
function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log: isProduction ? ["error"] : ["warn", "error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Trong dev, HMR load lại module liên tục. Không cache lại thì mỗi lần sửa file
// sẽ sinh thêm một connection pool, tới lúc Postgres từ chối kết nối mới.
if (!isProduction) {
  globalForPrisma.prisma = prisma;
}
