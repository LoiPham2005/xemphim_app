import { afterEach, describe, expect, it, vi } from "vitest";
import { __clearCache, cacheDel, cacheGet, cacheSet, cached } from "./cache";

/**
 * Môi trường test không set `REDIS_URL`, nên đây là bài test của store trong
 * RAM — đúng thứ chạy trên máy dev và trong CI.
 *
 * Nhánh Redis cố ý không mock: mock một client Redis chỉ chứng minh ta gọi
 * đúng những lệnh ta tự nghĩ ra, không chứng minh Redis hiểu như vậy. Phần đó
 * thuộc về test tích hợp với Redis thật.
 */
afterEach(async () => {
  await __clearCache();
});

describe("cacheGet / cacheSet", () => {
  it("đọc lại đúng giá trị đã ghi, giữ nguyên kiểu dữ liệu", async () => {
    await cacheSet("k", { a: 1, b: ["x"] }, 60);

    expect(await cacheGet("k")).toEqual({ a: 1, b: ["x"] });
  });

  it("trả null khi chưa có khoá", async () => {
    expect(await cacheGet("chua-ton-tai")).toBeNull();
  });

  it("hết hạn thì coi như chưa có", async () => {
    vi.useFakeTimers();
    try {
      await cacheSet("k", "giá trị", 10);
      expect(await cacheGet("k")).toBe("giá trị");

      vi.advanceTimersByTime(11_000);
      expect(await cacheGet("k")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cacheDel xoá ngay lập tức", async () => {
    await cacheSet("k", 1, 60);
    await cacheDel("k");

    expect(await cacheGet("k")).toBeNull();
  });
});

describe("cached", () => {
  it("chỉ tính MỘT lần rồi dùng lại kết quả", async () => {
    const compute = vi.fn().mockResolvedValue({ total: 42 });

    const first = await cached("stats", 60, compute);
    const second = await cached("stats", 60, compute);

    expect(first).toEqual({ total: 42 });
    expect(second).toEqual({ total: 42 });
    // Đây chính là lý do lớp cache tồn tại: truy vấn đắt không chạy lại.
    expect(compute).toHaveBeenCalledOnce();
  });

  it("tính lại sau khi khoá bị xoá", async () => {
    const compute = vi.fn().mockResolvedValue(1);

    await cached("k", 60, compute);
    await cacheDel("k");
    await cached("k", 60, compute);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("cache được cả giá trị falsy — 0 và chuỗi rỗng không phải là 'miss'", async () => {
    const zero = vi.fn().mockResolvedValue(0);
    await cached("zero", 60, zero);
    await cached("zero", 60, zero);

    // Lỗi kinh điển: dùng `if (!hit)` để nhận biết miss, khiến 0/""/false bị
    // tính lại mỗi lần. `cacheGet` so sánh với `null` chính vì vậy.
    expect(zero).toHaveBeenCalledOnce();
  });

  it("KHÔNG cache undefined — ghi vào là hỏng khoá", async () => {
    const undef = vi.fn().mockResolvedValue(undefined);

    await cached("u", 60, undef);
    await cached("u", 60, undef);

    // `JSON.stringify(undefined)` cho ra `undefined` chứ không phải chuỗi.
    expect(undef).toHaveBeenCalledTimes(2);
  });
});
