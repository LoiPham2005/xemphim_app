import { z } from "zod";
import { featureFlag } from "@/lib/feature-flag";

/**
 * Biến môi trường riêng của tiến trình worker.
 *
 * Tách khỏi `src/lib/env.ts` cùng lý do với `realtime/env.ts`: worker chỉ cần
 * đúng thứ nó dùng. Nhưng khác realtime ở hai điểm quan trọng:
 *
 *   - `REDIS_URL` là **BẮT BUỘC** (khi hàng đợi đang bật). Worker không có việc
 *     gì để làm nếu không có hàng đợi để lấy job ra — chạy mà không có Redis là
 *     một tiến trình ngồi im, tốn RAM, và trông như đang hoạt động.
 *   - `DATABASE_URL` cũng bắt buộc: job đọc/ghi database qua tầng service.
 */
const schema = z
  .object({
    /**
     * Cùng biến với app (`src/lib/env.ts`). `0` = dự án này không dùng hàng đợi,
     * nên worker không có lý do tồn tại — `main.ts` sẽ thoát ngay thay vì chạy.
     *
     * Nhận `1`/`0` vì `docker-compose.yml` dùng chính biến này làm `replicas`.
     */
    QUEUE_ENABLED: featureFlag(true),

    /**
     * Bắt buộc — nhưng chỉ khi hàng đợi đang bật (xem `superRefine` bên dưới).
     * Kiểm ở đó chứ không phải `.min(1)` ở đây, để `QUEUE_ENABLED=0` không bị
     * chặn bởi một biến mà nó vốn không cần.
     */
    REDIS_URL: z.string().optional(),

    /**
     * Số job chạy song song trong MỘT tiến trình worker.
     *
     * Mặc định 5 — đủ để không nghẽn vì một job chậm, mà không đủ để một loạt
     * job nặng bóp chết connection pool của database. Job nặng CPU thì hạ xuống;
     * job chủ yếu chờ mạng (gửi mail, gọi API) thì nâng lên được.
     */
    WORKER_CONCURRENCY: z.coerce.number().int().positive().max(100).default(5),

    /**
     * Cổng cho endpoint `/health` của worker.
     *
     * Worker không phục vụ request nghiệp vụ, nhưng vẫn cần một cách để bên
     * ngoài biết nó còn sống — Docker và trình quản lý tiến trình không có cách
     * nào khác để phân biệt "đang chạy" với "đã treo".
     *
     * Endpoint này trả kèm số job đang chờ/đang chạy/đã hỏng, nên nó cũng là
     * cách rẻ nhất để nhìn thấy hàng đợi mà không phải gõ `redis-cli`.
     */
    WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3003),
  })
  .superRefine((value, ctx) => {
    if (value.QUEUE_ENABLED && !value.REDIS_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["REDIS_URL"],
        message:
          "REDIS_URL là bắt buộc khi QUEUE_ENABLED=1 — worker không chạy được nếu thiếu hàng đợi. " +
          "Không dùng hàng đợi thì đặt QUEUE_ENABLED=0 và đừng chạy tiến trình này.",
      });
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Cấu hình worker không hợp lệ:\n${details}`);
}

export const workerEnv = parsed.data;
