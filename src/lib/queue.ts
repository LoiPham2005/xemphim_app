import type { Queue } from "bullmq";
import { env, isProduction } from "@/lib/env";
import { logger } from "@/lib/logger";
import { jobHandlers } from "@/jobs/handlers";
import type { JobName, JobPayloads } from "@/jobs/types";

/**
 * Hàng đợi job nền, chạy trên BullMQ + Redis.
 *
 * ---
 * VÌ SAO CẦN
 *
 * Có những việc không nên nằm trên đường đi của request: gửi email (SMTP mất
 * vài giây), gọi API bên thứ ba, xuất báo cáo, xử lý ảnh. Làm ngay trong
 * request thì người dùng ngồi chờ, và một lần mạng chậm là một lần họ thấy
 * trang treo.
 *
 * Hàng đợi còn cho hai thứ mà chạy thẳng không có: **thử lại tự động** khi
 * thất bại, và **không mất việc** khi tiến trình chết giữa chừng.
 *
 * ---
 * KHÔNG CÓ REDIS THÌ SAO — VÀ VÌ SAO KHÔNG IM LẶNG BỎ QUA
 *
 *   - Có `REDIS_URL`  → đẩy vào hàng đợi, worker xử lý (đường đi thật).
 *   - Không, và đang DEV → chạy NGAY trong tiến trình hiện tại, kèm cảnh báo.
 *   - Không, và đang PRODUCTION → **NÉM LỖI**.
 *
 * Vế cuối là phần quan trọng nhất: im lặng bỏ qua job trên production nghĩa là
 * email không bao giờ gửi, báo cáo không bao giờ chạy — mà không có dòng log
 * nào nói rằng có việc đã bị nuốt. Thà hỏng ngay lúc deploy.
 *
 * ---
 * DỰ ÁN KHÔNG CẦN HÀNG ĐỢI: `QUEUE_ENABLED=0`
 *
 * Không phải dự án nào cũng đáng dựng thêm Redis và một tiến trình thứ ba.
 * `QUEUE_ENABLED=0` thì `enqueue()` chạy handler ngay trong request — kể cả
 * trên production, và đó là hành vi ĐÚNG chứ không phải sự cố: cấu hình nói rõ
 * là không dùng hàng đợi.
 *
 * Khác biệt so với nhánh "thiếu Redis" ở trên là AI QUYẾT ĐỊNH. Thiếu
 * `REDIS_URL` là quên; `QUEUE_ENABLED=0` là chọn. Bộ khung chỉ ném lỗi với vế
 * đầu.
 */

export const QUEUE_NAME = "app";

type BullQueue = Queue<unknown, void, string>;

let queuePromise: Promise<BullQueue> | null = null;

async function getQueue(url: string): Promise<BullQueue> {
  queuePromise ??= (async () => {
    // Import động: máy không cấu hình Redis thì BullMQ không bao giờ được nạp.
    const { Queue } = await import("bullmq");

    const queue = new Queue(QUEUE_NAME, {
      connection: { url },
      defaultJobOptions: {
        // Thử lại 3 lần với khoảng cách tăng dần (1s, 2s, 4s). Phần lớn thất
        // bại là tạm thời — SMTP nghẽn, API bên kia trả 503 — và chờ một chút
        // rồi thử lại giải quyết được hầu hết.
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },

        // Dọn job đã xong, nếu không Redis phình vô hạn. Giữ lại một ít để còn
        // soi được khi cần.
        removeOnComplete: { age: 3600, count: 1000 },
        // Job THẤT BẠI giữ lâu hơn hẳn — đó mới là thứ cần điều tra, và nó
        // thường chỉ được phát hiện sau vài ngày.
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });

    logger.info("Queue: đã kết nối Redis");
    return queue as BullQueue;
  })();

  return queuePromise;
}

export type EnqueueOptions = {
  /**
   * Khoá chống trùng. Hai job cùng `jobId` thì BullMQ chỉ giữ một.
   *
   * Dùng khi việc của bạn KHÔNG chịu được chạy hai lần — trừ tiền, cấp mã giảm
   * giá. Đặt theo định danh nghiệp vụ (`"invoice:123"`), đừng đặt ngẫu nhiên vì
   * như vậy là không chống được gì.
   */
  jobId?: string;
  /** Hoãn lại bao nhiêu mili-giây trước khi chạy. */
  delay?: number;
};

/**
 * Đẩy một job vào hàng đợi.
 *
 * @throws Khi `QUEUE_ENABLED` bật, đang production, mà thiếu `REDIS_URL`.
 *
 * @example await enqueue("email:send", { to, subject, text });
 */
export async function enqueue<TName extends JobName>(
  name: TName,
  payload: JobPayloads[TName],
  options: EnqueueOptions = {},
): Promise<void> {
  if (!env.QUEUE_ENABLED) {
    /*
     * Hàng đợi bị TẮT CÓ CHỦ ĐÍCH — khác hẳn nhánh "thiếu Redis" bên dưới, nên
     * ở đây không cảnh báo và cũng không ném lỗi trên production.
     *
     * Lỗi trong handler được để BUNG RA nguyên vẹn. Nuốt nó đi thì tắt hàng đợi
     * biến thành "job im lặng biến mất" — đúng thứ mà cả file này tồn tại để
     * ngăn.
     */
    logger.debug(`QUEUE_ENABLED=0 — chạy job "${name}" ngay trong tiến trình này`);
    await jobHandlers[name](payload);
    return;
  }

  if (!env.REDIS_URL) {
    if (isProduction) {
      throw new Error(
        `Không đẩy được job "${name}": QUEUE_ENABLED đang bật nhưng thiếu REDIS_URL. ` +
          `Trên production, job bị bỏ qua trong im lặng là hành vi nguy hiểm nên phải ` +
          `chọn một trong hai đường:\n` +
          `  • Đặt REDIS_URL rồi chạy apps/worker — có thử lại tự động.\n` +
          `  • Hoặc đặt QUEUE_ENABLED=0 để job chạy thẳng trong request — không cần ` +
          `Redis, nhưng người dùng phải chờ và không có thử lại.`,
      );
    }

    logger.warn(
      `Queue chưa có Redis — chạy job "${name}" NGAY trong tiến trình này. ` +
        `Chỉ dành cho dev: không có thử lại, không sống sót qua restart.`,
    );

    await jobHandlers[name](payload);
    return;
  }

  const queue = await getQueue(env.REDIS_URL);
  await queue.add(name, payload, { jobId: options.jobId, delay: options.delay });

  logger.debug("Đã đẩy job vào hàng đợi", { name, jobId: options.jobId });
}

/**
 * `true` khi job THẬT SỰ chạy nền — tức là cờ đang bật VÀ có Redis để đẩy vào.
 *
 * Cố ý không chỉ đọc `QUEUE_ENABLED`: bật cờ mà thiếu Redis thì job vẫn chạy
 * đồng bộ (ở dev) chứ không chạy nền, nên trả `true` là nói sai.
 */
export function isQueueEnabled(): boolean {
  return env.QUEUE_ENABLED && Boolean(env.REDIS_URL);
}

/** Số job đang chờ/đang chạy/thất bại. `null` khi không dùng hàng đợi. */
export async function getQueueCounts(): Promise<Record<string, number> | null> {
  if (!isQueueEnabled() || !env.REDIS_URL) return null;
  const queue = await getQueue(env.REDIS_URL);
  return queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
}

/** Đóng kết nối. Gọi khi script ngắn hạn kết thúc, nếu không tiến trình treo. */
export async function closeQueue(): Promise<void> {
  if (!queuePromise) return;
  const queue = await queuePromise;
  await queue.close();
  queuePromise = null;
}
