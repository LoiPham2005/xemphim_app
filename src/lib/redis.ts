import type { createClient, RedisClientType } from "redis";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * MỘT kết nối Redis dùng chung cho cache, rate limit và health check.
 *
 * Trước khi gom về đây, mỗi module tự `createClient()` riêng — tức là ba kết
 * nối tới cùng một máy chủ, ba lần bắt tay, và ba nơi phải nhớ đăng ký handler
 * `error`. Redis giới hạn số kết nối, và cái giá đó nhân lên theo số instance.
 *
 * BullMQ là ngoại lệ có lý do: nó cần kết nối riêng ở chế độ blocking (BRPOP),
 * không dùng chung được với client thường — xem `infra/queue.ts`.
 */

type RedisClient = ReturnType<typeof createClient>;

let clientPromise: Promise<RedisClient> | null = null;

/** `null` khi chưa cấu hình `REDIS_URL` — nơi gọi phải tự có đường lui. */
export function getRedis(): Promise<RedisClient> | null {
  if (!env.REDIS_URL) return null;

  const url = env.REDIS_URL;

  clientPromise ??= (async () => {
    // Import động: máy không cấu hình Redis thì thư viện không bao giờ vào bộ nhớ.
    const { createClient } = await import("redis");
    const client: RedisClient = createClient({ url });

    // node-redis phát sự kiện 'error' mỗi lần mất kết nối; không ai nghe thì
    // nó thành unhandled error và GIẾT tiến trình.
    client.on("error", (error: unknown) => {
      logger.error("Redis: lỗi kết nối", error);
    });

    await client.connect();
    logger.info("Redis: đã kết nối", { url: redactUrl(url) });
    return client;
  })();

  return clientPromise;
}

/** Bỏ mật khẩu khỏi connection string trước khi đưa vào log. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "(không đọc được)";
  }
}

/** Gọi khi script ngắn hạn kết thúc, nếu không tiến trình treo. */
export async function closeRedis(): Promise<void> {
  if (!clientPromise) return;
  const client = await clientPromise;
  await client.quit();
  clientPromise = null;
}

export type { RedisClient, RedisClientType };
