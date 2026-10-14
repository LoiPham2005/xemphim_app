import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

/**
 * Cache khoá–giá trị có TTL. Dùng Redis khi có `REDIS_URL`, RAM khi không.
 *
 * ---
 * DÙNG KHI NÀO
 *
 * Cho truy vấn ĐẮT mà dữ liệu ĐỔI CHẬM: bảng danh mục, cấu hình, kết quả tổng
 * hợp báo cáo, phản hồi từ API bên thứ ba.
 *
 * KHÔNG dùng cho dữ liệu người dùng vừa sửa xong — họ sẽ thấy giá trị cũ và
 * nghĩ hệ thống hỏng. Với loại đó, hoặc đừng cache, hoặc xoá khoá NGAY trong
 * chính thao tác ghi.
 *
 * ---
 * QUY TẮC AN TOÀN
 *
 * Store hỏng thì coi như CACHE MISS, KHÔNG BAO GIỜ ném lỗi lên trên. Redis
 * chết không được phép làm sập trang — cùng nguyên tắc với `rate-limit.ts`.
 */

/** Tiền tố riêng, để không giẫm lên khoá của rate limit (`rl:`). */
const PREFIX = "cache:";

type CacheStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  delByPrefix(prefix: string): Promise<void>;
  clear(): Promise<void>;
};

function createMemoryStore(): CacheStore {
  const entries = new Map<string, { value: string; expiresAt: number }>();

  /**
   * Bản RAM không có cơ chế hết hạn tự động như Redis, nên nếu chỉ kiểm tra
   * lúc đọc thì khoá không ai đọc lại sẽ nằm mãi trong bộ nhớ.
   */
  function evictExpired(now: number) {
    if (entries.size < 5_000) return;
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key);
    }
  }

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return Promise.resolve(null);

      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return Promise.resolve(null);
      }

      return Promise.resolve(entry.value);
    },
    set(key, value, ttlSeconds) {
      evictExpired(Date.now());
      entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return Promise.resolve();
    },
    del(key) {
      entries.delete(key);
      return Promise.resolve();
    },
    delByPrefix(prefix) {
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
      return Promise.resolve();
    },
    clear() {
      entries.clear();
      return Promise.resolve();
    },
  };
}

function createRedisStore(): CacheStore {
  async function client() {
    const redis = getRedis();
    if (!redis) throw new Error("Redis chưa được cấu hình");
    return redis;
  }

  /**
   * Dùng SCAN chứ KHÔNG dùng KEYS: `KEYS *` khoá cả Redis lại trong lúc quét,
   * và trên production với vài trăm nghìn khoá thì đó là một sự cố.
   */
  async function scanDelete(pattern: string) {
    const redis = await client();
    for await (const keys of redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      const batch = Array.isArray(keys) ? keys : [keys];
      if (batch.length > 0) await redis.del(batch);
    }
  }

  return {
    async get(key) {
      return (await client()).get(`${PREFIX}${key}`);
    },
    async set(key, value, ttlSeconds) {
      // Redis tự xoá khi hết hạn — không cần tiến trình dọn dẹp nào.
      await (
        await client()
      ).set(`${PREFIX}${key}`, value, {
        expiration: { type: "EX", value: ttlSeconds },
      });
    },
    async del(key) {
      await (await client()).del(`${PREFIX}${key}`);
    },
    delByPrefix(prefix) {
      return scanDelete(`${PREFIX}${prefix}*`);
    },
    clear() {
      return scanDelete(`${PREFIX}*`);
    },
  };
}

let store: CacheStore | null = null;

function getStore(): CacheStore {
  store ??= getRedis() ? createRedisStore() : createMemoryStore();
  return store;
}

/**
 * Đọc giá trị đã cache. Trả `null` khi chưa có, đã hết hạn, hoặc store lỗi.
 *
 * Kiểu `T` là LỜI HỨA của người gọi, không phải điều được kiểm chứng — giá trị
 * đi qua JSON nên không còn kiểu. Đổi hình dạng dữ liệu thì đổi luôn tên khoá
 * (`user:v2:...`), nếu không bản deploy mới vẫn đọc phải giá trị hình dạng cũ.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getStore().get(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch (error) {
    // Bao gồm cả JSON hỏng: coi như miss và tính lại, chứ không ném lỗi ra
    // ngoài chỉ vì một khoá cache bị rác.
    logger.error("Cache: đọc thất bại, coi như miss", error, { key });
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await getStore().set(key, JSON.stringify(value), ttlSeconds);
  } catch (error) {
    logger.error("Cache: ghi thất bại", error, { key });
  }
}

/** Xoá một khoá. Gọi NGAY trong thao tác ghi làm dữ liệu đó cũ đi. */
export async function cacheDel(key: string): Promise<void> {
  try {
    await getStore().del(key);
  } catch (error) {
    logger.error("Cache: xoá thất bại", error, { key });
  }
}

/**
 * Xoá mọi khoá bắt đầu bằng `prefix`.
 *
 * Dùng khi một thay đổi làm cũ đi cả một họ khoá — ví dụ sửa phân quyền làm
 * hỏng toàn bộ `perm:*`, không chỉ khoá của một người.
 */
export async function cacheDelByPrefix(prefix: string): Promise<void> {
  try {
    await getStore().delByPrefix(prefix);
  } catch (error) {
    logger.error("Cache: xoá theo tiền tố thất bại", error, { prefix });
  }
}

/**
 * Đọc từ cache, thiếu thì tính rồi ghi lại. API nên dùng trong 90% trường hợp.
 *
 * @example
 * const stats = await cached("dashboard:stats", 300, () => reportService.build());
 *
 * ⚠️ KHÔNG chống "cache stampede": 100 request cùng đến lúc khoá vừa hết hạn
 * thì cả 100 đều tính lại. Chấp nhận vì chống nó cần khoá phân tán — phức tạp
 * hơn nhiều so với lợi ích ở quy mô thông thường. Truy vấn nặng tới mức không
 * chịu được điều đó thì hãy tính sẵn bằng job nền rồi chỉ đọc kết quả ra.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;

  const value = await compute();

  // Không cache `undefined`: JSON.stringify(undefined) cho ra `undefined` chứ
  // không phải chuỗi, ghi vào là hỏng khoá.
  if (value !== undefined) await cacheSet(key, value, ttlSeconds);

  return value;
}

/** Chỉ dùng trong test. */
export async function __clearCache(): Promise<void> {
  await getStore().clear();
}
