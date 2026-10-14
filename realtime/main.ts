import { logger } from "@/lib/logger";
import { realtimeEnv } from "./env";
import { startRealtime } from "./server";

/**
 * Entry của tiến trình realtime.
 *
 * Tách khỏi server.ts để test có thể gọi `startRealtime()` rồi tự dừng, thay vì
 * import một file là nó tự chạy và không tắt được.
 */
async function main() {
  // Cùng lý do với `worker/main.ts`: cấu hình nói không dùng WebSocket mà tiến
  // trình WebSocket vẫn được dựng là mâu thuẫn, và mâu thuẫn thì phải nhìn thấy
  // được. Đường tắt đúng là không dựng nó — xem `REALTIME_ENABLED`.
  if (!realtimeEnv.REALTIME_ENABLED) {
    logger.warn(
      "REALTIME_ENABLED=0 — WebSocket đã tắt nên tiến trình này không cần chạy. Thoát.\n" +
        "Nhớ bỏ luôn khối `/socket.io/*` trong Caddyfile, không thì proxy trả 502 thay vì 404.",
    );
    process.exit(0);
  }

  const realtime = await startRealtime();

  const shutdown = () => {
    logger.info("Đang tắt realtime…");
    realtime
      .stop()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };

  // Container bị dừng thì đóng kết nối gọn gàng, không cắt ngang giữa chừng.
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error: unknown) => {
  logger.error("Realtime không khởi động được", error);
  process.exit(1);
});
