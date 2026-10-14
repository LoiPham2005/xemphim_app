import { z } from "zod";
import { featureFlag } from "@/lib/feature-flag";

/**
 * Biến môi trường riêng của tiến trình realtime.
 *
 * Tách khỏi `src/lib/env.ts` có chủ đích: realtime KHÔNG cần DATABASE_URL hay
 * ADMIN_PASSWORD, và bắt nó khai báo những thứ đó chỉ tạo ra cấu hình giả để
 * làm hài lòng bộ validate. Nó chỉ cần đúng thứ nó dùng.
 *
 * Riêng SESSION_SECRET thì BẮT BUỘC giống hệt app chính — token do web/mobile
 * cấp phải verify được ở đây, nếu lệch thì mọi kết nối đều bị từ chối.
 */
const schema = z.object({
  /**
   * Cùng biến với app (`src/lib/env.ts`). `0` = dự án này không dùng WebSocket,
   * nên `main.ts` thoát ngay thay vì mở một cổng chẳng ai gọi tới.
   *
   * Nhận `1`/`0` vì `docker-compose.yml` dùng chính biến này làm `replicas`.
   */
  REALTIME_ENABLED: featureFlag(true),

  REALTIME_PORT: z.coerce.number().int().positive().default(3002),

  /** Bỏ trống = chạy một instance. Bắt buộc khi scale từ 2 instance trở lên. */
  REDIS_URL: z.string().min(1).optional(),

  REALTIME_CORS_ORIGIN: z.string().default("http://localhost:3000"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Cấu hình realtime không hợp lệ:\n${details}`);
}

export const realtimeEnv = parsed.data;
