// Prisma 7 không còn tự nạp `.env` như bản 6. Không có dòng này thì mọi lệnh
// CLI đều chết với "Cannot resolve environment variable: DATABASE_URL".
// Trên CI và production, biến đã có sẵn trong môi trường nên dòng này không
// làm gì cả — nó chỉ phục vụ máy dev.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Cấu hình cho Prisma CLI (generate, migrate, studio, seed).
 *
 * Prisma 7 bỏ `url` khỏi khối `datasource` trong schema.prisma. Chuỗi kết nối
 * giờ nằm ở hai chỗ tách bạch:
 *   - file này  → cho CLI và Migrate
 *   - driver adapter trong src/lib/prisma.ts → cho runtime của ứng dụng
 */
export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },

  datasource: {
    // Migrate cần kết nối trực tiếp, không qua connection pooler. Nếu dùng
    // PgBouncer/Neon/Supabase thì set DIRECT_DATABASE_URL trỏ tới cổng trực
    // tiếp; runtime vẫn dùng DATABASE_URL qua pooler.
    url: process.env.DIRECT_DATABASE_URL ?? env("DATABASE_URL"),
  },
});
