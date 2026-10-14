import { afterEach, describe, expect, it } from "vitest";
import { __clearRateLimits, rateLimit, resetRateLimit } from "./rate-limit";

/**
 * Không set `REDIS_URL` trong môi trường test, nên đây là bài test của store
 * trong RAM — đúng thứ chạy trên máy dev và trong CI.
 *
 * Nhánh Redis cố ý không mock: mock một client Redis chỉ kiểm được rằng ta đã
 * gọi đúng những lệnh ta tự nghĩ ra, không kiểm được Redis có hiểu như vậy
 * không. Phần đó thuộc về test tích hợp với một Redis thật.
 */
afterEach(async () => {
  await __clearRateLimits();
});

describe("rateLimit", () => {
  it("cho qua đúng bằng số lần cho phép rồi mới chặn", async () => {
    const options = { limit: 3, windowSeconds: 60 };

    expect((await rateLimit("ip-1", options)).success).toBe(true);
    expect((await rateLimit("ip-1", options)).success).toBe(true);
    expect((await rateLimit("ip-1", options)).success).toBe(true);
    expect((await rateLimit("ip-1", options)).success).toBe(false);
  });

  it("đếm riêng cho từng key", async () => {
    const options = { limit: 1, windowSeconds: 60 };

    expect((await rateLimit("ip-1", options)).success).toBe(true);
    expect((await rateLimit("ip-2", options)).success).toBe(true);
    expect((await rateLimit("ip-1", options)).success).toBe(false);
  });

  it("báo số lần còn lại", async () => {
    const options = { limit: 2, windowSeconds: 60 };

    expect((await rateLimit("ip-1", options)).remaining).toBe(1);
    expect((await rateLimit("ip-1", options)).remaining).toBe(0);
  });

  it("reset xoá sạch bộ đếm", async () => {
    const options = { limit: 1, windowSeconds: 60 };

    await rateLimit("ip-1", options);
    expect((await rateLimit("ip-1", options)).success).toBe(false);

    await resetRateLimit("ip-1");
    expect((await rateLimit("ip-1", options)).success).toBe(true);
  });

  it("luôn trả retryAfterSeconds ít nhất là 1", async () => {
    const result = await rateLimit("ip-1", { limit: 1, windowSeconds: 1 });
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });
});
