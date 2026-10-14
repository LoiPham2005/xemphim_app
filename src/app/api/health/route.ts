import { NextResponse } from "next/server";
import { healthService } from "@/services/health.service";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";

/**
 * Health check cho Docker / Kubernetes / load balancer.
 *
 * Có kiểm tra database thật (không chỉ "process còn sống"): một container còn
 * chạy nhưng mất kết nối DB thì vẫn phải bị xoay vòng, không nên nhận traffic.
 *
 * Trả kèm `features` — deploy này ĐÁNG LẼ có những tiến trình phụ nào. Đây là
 * thứ duy nhất phân biệt được "chưa bao giờ bật" với "đã bật mà chết": không
 * có nó thì một worker chết im lặng trông hệt như một dự án cố ý không dùng
 * hàng đợi, và người trực phải đi đọc file .env trên máy chủ mới biết.
 *
 * Không có gì nhạy cảm ở đây — chỉ là hai chữ bật/tắt, không phải địa chỉ hay
 * khoá. Endpoint này vốn đã công khai vì Docker/load balancer phải gọi được.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * `queue` có ba trạng thái chứ không phải hai, vì "bật" chưa nói hết chuyện:
 *
 *   - `off`    — `QUEUE_ENABLED=0`, job chạy thẳng trong request. Cố ý.
 *   - `inline` — cờ bật nhưng THIẾU `REDIS_URL`. Ở dev job vẫn chạy đồng bộ;
 *                trên production `enqueue()` ném lỗi. Gần như luôn là nhầm.
 *   - `redis`  — đường đi thật: có hàng đợi, có worker xử lý.
 *
 * Gộp `inline` vào `on` là giấu đúng cái trạng thái cần nhìn thấy nhất.
 */
function featureStatus() {
  return {
    queue: !env.QUEUE_ENABLED ? "off" : env.REDIS_URL ? "redis" : "inline",
    realtime: env.REALTIME_ENABLED ? "on" : "off",
  } as const;
}

export async function GET() {
  const database = await healthService.checkDatabase();

  if (database.status === "down") {
    logger.error("Health check thất bại: không nối được database");

    // 503 chứ không phải 500: load balancer phải hiểu là "đừng gửi traffic
    // vào đây nữa", không phải "request này lỗi".
    return NextResponse.json(
      {
        status: "error",
        database: "down",
        features: featureStatus(),
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      status: "ok",
      database: "up",
      latencyMs: database.latencyMs,
      features: featureStatus(),
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
