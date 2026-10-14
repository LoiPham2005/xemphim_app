import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { workerEnv } from "./env";
import { startWorker } from "./worker";

/**
 * Entry của tiến trình worker.
 *
 * Tách khỏi `worker.ts` để test gọi được `startWorker()` rồi tự dừng, thay vì
 * import một file là nó tự chạy và không tắt được — giống cách `realtime/` làm.
 */
function main() {
  /*
   * Chốt chặn cho cấu hình tự mâu thuẫn: hàng đợi đã tắt mà worker vẫn được
   * dựng lên. Lúc đó `enqueue()` chạy job thẳng trong request, còn tiến trình
   * này ngồi chờ một hàng đợi không bao giờ có gì — tốn RAM và, tệ hơn, trông
   * y như đang hoạt động bình thường.
   *
   * Đường tắt ĐÚNG là không dựng tiến trình này ngay từ đầu; cùng biến
   * `QUEUE_ENABLED` lo việc đó ở cả ba đường deploy (`replicas` trong compose,
   * lọc app trong ecosystem.config.cjs, `systemctl disable` với systemd). Nhánh
   * dưới đây chỉ để trường hợp lọt lưới không diễn ra trong im lặng.
   */
  if (!workerEnv.QUEUE_ENABLED) {
    logger.warn(
      "QUEUE_ENABLED=0 — hàng đợi đã tắt nên worker không có việc gì để làm. Thoát.\n" +
        "Nếu đây là ngoài ý muốn: đặt QUEUE_ENABLED=1 rồi dựng lại.\n" +
        "Nếu đúng ý: gỡ tiến trình này khỏi cấu hình deploy (docker compose up -d " +
        "sẽ tự gỡ container, systemd thì `systemctl disable --now xemphim-worker`).",
    );
    process.exit(0);
  }

  const worker = startWorker();

  const shutdown = () => {
    logger.info("Đang tắt worker…");

    // `stop()` ĐỢI các job đang chạy dở hoàn tất. Đây là điểm quan trọng nhất
    // của việc tắt gọn gàng: cắt ngang một job đã trừ tiền nhưng chưa ghi nhận
    // là để lại dữ liệu sai. Job chưa bắt đầu vẫn nằm nguyên trong Redis, một
    // worker khác (hoặc chính tiến trình này sau khi khởi động lại) sẽ nhận.
    //
    // ⚠️ Trình quản lý tiến trình phải cho đủ thời gian: mặc định Docker chỉ
    // đợi 10 giây sau SIGTERM rồi SIGKILL. Job dài hơn thế thì nâng
    // `stop_grace_period` trong compose.
    worker
      .stop()
      .then(() => prisma.$disconnect())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error("Tắt worker không sạch", error);
        process.exit(1);
      });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

try {
  main();
} catch (error: unknown) {
  logger.error("Worker không khởi động được", error);
  process.exit(1);
}
