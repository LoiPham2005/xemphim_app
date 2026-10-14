import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

/**
 * Rate limiter cửa sổ cố định. Dùng Redis khi có `REDIS_URL`, RAM khi không.
 *
 * ---
 * VÌ SAO CẦN REDIS
 *
 * Đếm trong RAM đủ cho đúng MỘT container, nhưng hỏng theo hai cách khi lên thật:
 *
 *   - Chạy 2 replica → mỗi replica đếm riêng → ngưỡng thực tế nhân đôi. Kẻ dò
 *     mật khẩu chỉ cần bắn qua load balancer là được gấp N lần số lần thử.
 *   - Deploy hoặc restart → bộ đếm về 0. Đúng lúc bị dò, việc restart lại là
 *     món quà cho phía tấn công.
 *
 * ---
 * VÌ SAO VẪN GIỮ BẢN RAM
 *
 * Bắt buộc phải có Redis mới chạy được `pnpm dev` là một rào cản vô nghĩa.
 */

export type RateLimitOptions = { limit: number; windowSeconds: number };

/**
 * Ngưỡng cho từng loại thao tác, khai báo MỘT LẦN.
 *
 * Web và mobile là hai cửa vào khác nhau nhưng phải chịu chung một chính sách.
 * Rải các con số này ở từng controller thì siết ngưỡng đăng nhập mà quên một
 * chỗ là cửa còn lại vẫn mở.
 */
export const RATE_LIMITS = {
  login: { limit: 5, windowSeconds: 300 },
  register: { limit: 5, windowSeconds: 3600 },
  refresh: { limit: 30, windowSeconds: 300 },

  /**
   * Gửi email: siết chặt hơn hẳn. Không phải để chống dò mật khẩu, mà để hệ
   * thống không bị biến thành công cụ dội thư rác — mỗi lần gọi là một email
   * gửi tới địa chỉ do người gọi chỉ định. Chi phí nằm ở hộp thư người khác và
   * ở uy tín tên miền gửi của bạn.
   */
  passwordResetRequest: { limit: 3, windowSeconds: 900 },
  emailVerificationRequest: { limit: 3, windowSeconds: 900 },

  /**
   * Đổi/đặt lại mật khẩu. Token là 256 bit ngẫu nhiên nên không dò được, nhưng
   * mỗi lần gọi đều tốn một phép băm Argon2id — vốn cố tình ngốn bộ nhớ. Không
   * giới hạn thì chính endpoint này là đường tấn công từ chối dịch vụ rẻ nhất
   * của hệ thống.
   */
  passwordChange: { limit: 10, windowSeconds: 900 },

  /**
   * Mọi endpoint nhập mã 2FA (xác minh lúc đăng nhập, bật, tắt, cấp lại mã).
   *
   * Siết chặt vì mã TOTP chỉ có 10^6 khả năng và mã khôi phục thì ít hơn nhiều
   * so với một token 256 bit. `VERIFICATION_MAX_ATTEMPTS` chặn theo từng mã;
   * ngưỡng này chặn theo IP — hai lớp cho hai kiểu tấn công khác nhau.
   */
  twoFactor: { limit: 10, windowSeconds: 300 },

  /**
   * Đăng nhập/đăng ký bằng passkey.
   *
   * Rộng hơn `login` vì passkey KHÔNG dò được (chữ ký khoá công khai, không
   * có gì để đoán) — giới hạn ở đây chỉ để chống bơm request, không phải chống
   * dò thông tin đăng nhập.
   */
  passkey: { limit: 30, windowSeconds: 300 },

  /**
   * Xin mã OTP qua SMS — ngưỡng theo IP.
   *
   * Đây mới chỉ là lớp thứ nhất. Hai lớp còn lại (giãn cách và trần theo ngày
   * trên từng SỐ ĐIỆN THOẠI) nằm trong `AuthService.requestPhoneVerification`,
   * vì chỉ ở đó mới biết số điện thoại là gì.
   */
  phoneOtp: { limit: 5, windowSeconds: 900 },

  /** Xin link upload — chặn việc bơm rác vào kho lưu trữ. */
  upload: { limit: 60, windowSeconds: 300 },
} as const satisfies Record<string, RateLimitOptions>;

export type RateLimitScope = keyof typeof RATE_LIMITS;

export type RateLimitResult = {
  success: boolean;
  remaining: number;
  limit: number;
  /** Số giây còn lại tới khi cửa sổ reset. */
  retryAfterSeconds: number;
};

/**
 * `hit` trả về số lần đã dùng trong cửa sổ hiện tại và thời điểm reset. Phần
 * quyết định cho qua hay chặn nằm NGOÀI store — nhờ vậy chính sách chỉ tồn tại
 * ở một chỗ, dù đang chạy trên RAM hay trên Redis.
 */
type RateLimitStore = {
  hit(key: string, windowSeconds: number): Promise<{ count: number; resetAt: number }>;
  reset(key: string): Promise<void>;
  clear(): Promise<void>;
};

const REDIS_PREFIX = "rl:";

function createMemoryStore(): RateLimitStore {
  type Bucket = { count: number; resetAt: number };
  const buckets = new Map<string, Bucket>();

  /** Dọn bucket hết hạn để Map không phình vô hạn theo số IP đã từng gọi. */
  function evictExpired(now: number) {
    if (buckets.size < 10_000) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return {
    hit(key, windowSeconds) {
      const now = Date.now();
      evictExpired(now);

      const existing = buckets.get(key);
      const bucket =
        existing && existing.resetAt > now
          ? existing
          : { count: 0, resetAt: now + windowSeconds * 1000 };

      bucket.count += 1;
      buckets.set(key, bucket);

      return Promise.resolve({ count: bucket.count, resetAt: bucket.resetAt });
    },
    reset(key) {
      buckets.delete(key);
      return Promise.resolve();
    },
    clear() {
      buckets.clear();
      return Promise.resolve();
    },
  };
}

function createRedisStore(): RateLimitStore {
  async function client() {
    const redis = getRedis();
    if (!redis) throw new Error("Redis chưa được cấu hình");
    return redis;
  }

  return {
    async hit(key, windowSeconds) {
      const redis = await client();
      const redisKey = `${REDIS_PREFIX}${key}`;

      /*
       * INCR rồi mới EXPIRE, và chỉ EXPIRE ở lần đầu tiên (`NX`).
       *
       * Thứ tự này quan trọng: đặt lại TTL ở mỗi lần gọi sẽ biến cửa sổ cố
       * định thành cửa sổ trượt vô hạn — kẻ tấn công gõ đều tay thì khoá không
       * bao giờ hết hạn, kể cả sau khi họ đã dừng.
       *
       * Gộp vào một pipeline để chỉ đi MỘT vòng mạng.
       */
      const replies = (await redis
        .multi()
        .incr(redisKey)
        .expire(redisKey, windowSeconds, "NX")
        .ttl(redisKey)
        .exec()) as unknown[];

      const count = Number(replies[0]);
      const ttl = Number(replies[2]);

      // TTL âm nghĩa là khoá không có hạn (-1) hoặc vừa biến mất (-2). Cả hai
      // đều bất thường; coi như cửa sổ vừa mở để không chặn oan người dùng.
      const remainingSeconds = Number.isFinite(ttl) && ttl >= 0 ? ttl : windowSeconds;

      return { count, resetAt: Date.now() + remainingSeconds * 1000 };
    },
    async reset(key) {
      await (await client()).del(`${REDIS_PREFIX}${key}`);
    },
    async clear() {
      const redis = await client();
      // Chỉ xoá khoá của rate limit — instance Redis này còn dùng cho cache và
      // hàng đợi.
      for await (const keys of redis.scanIterator({ MATCH: `${REDIS_PREFIX}*`, COUNT: 100 })) {
        const batch = Array.isArray(keys) ? keys : [keys];
        if (batch.length > 0) await redis.del(batch);
      }
    },
  };
}

let store: RateLimitStore | null = null;

function getStore(): RateLimitStore {
  if (store) return store;

  if (getRedis()) {
    store = createRedisStore();
  } else {
    store = createMemoryStore();
    logger.warn(
      "Rate limit chạy trong RAM (chưa set REDIS_URL). " +
        "Đủ cho một instance; từ instance thứ hai trở đi mỗi bản đếm riêng nên " +
        "ngưỡng thực tế bị nhân lên theo số instance.",
    );
  }

  return store;
}

export async function rateLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
  let hit: { count: number; resetAt: number };

  try {
    hit = await getStore().hit(key, options.windowSeconds);
  } catch (error) {
    /*
     * FAIL-OPEN, có chủ đích.
     *
     * Redis chết mà ta chặn hết mọi request thì một sự cố hạ tầng biến thành
     * sập dịch vụ toàn phần — đăng nhập, đăng ký, quên mật khẩu, tất cả đứng
     * im. Đổi lại là một cửa sổ không có rate limit, đúng bằng thời gian Redis
     * chết.
     *
     * Đánh đổi này CÓ THẬT: nếu hệ thống của bạn coi brute-force nguy hiểm hơn
     * downtime, đổi chỗ này thành chặn.
     */
    logger.error("Rate limit: store lỗi, tạm cho qua", error, { key });
    return { success: true, remaining: options.limit, limit: options.limit, retryAfterSeconds: 0 };
  }

  return {
    success: hit.count <= options.limit,
    remaining: Math.max(0, options.limit - hit.count),
    limit: options.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((hit.resetAt - Date.now()) / 1000)),
  };
}

/** Xoá giới hạn của một key — gọi sau khi đăng nhập THÀNH CÔNG. */
export async function resetRateLimit(key: string): Promise<void> {
  try {
    await getStore().reset(key);
  } catch (error) {
    // Không ném lên: người dùng vừa đăng nhập thành công. Chặn họ chỉ vì dọn
    // bộ đếm thất bại là biến một thao tác nền thành lỗi nhìn thấy được.
    logger.error("Rate limit: không xoá được bộ đếm", error, { key });
  }
}

/** Chỉ dùng trong test. */
export async function __clearRateLimits(): Promise<void> {
  await getStore().clear();
}
