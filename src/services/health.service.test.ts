import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { HealthService } from "./health.service";

function createDb(queryRaw: ReturnType<typeof vi.fn>) {
  return { $queryRaw: queryRaw } as unknown as PrismaClient;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("HealthService.checkDatabase", () => {
  it("database trả lời thì báo up kèm thời gian ping", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const queryRaw = vi.fn(() => {
      // Giả lập câu truy vấn mất 12ms để kiểm latency được đo quanh đúng lần
      // ping, không phải một con số bịa.
      vi.setSystemTime(12);
      return Promise.resolve([{ "?column?": 1 }]);
    });

    const result = await new HealthService(createDb(queryRaw)).checkDatabase();

    expect(result).toEqual({ status: "up", latencyMs: 12 });
  });

  it("ping bằng SELECT 1 — không đụng bảng dữ liệu nào", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    await new HealthService(createDb(queryRaw)).checkDatabase();

    // `$queryRaw` là tagged template: đối số đầu là mảng các đoạn chuỗi.
    // `count()` trên một bảng sẽ chậm dần khi bảng lớn và có thể chờ khoá —
    // health check không được phép như vậy.
    const strings = queryRaw.mock.calls[0]![0] as TemplateStringsArray;
    expect(strings.join("")).toBe("SELECT 1");
  });

  it("database lỗi thì TRẢ VỀ down thay vì ném lỗi", async () => {
    const queryRaw = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));

    // Ném lỗi ra thì load balancer chỉ thấy 500/timeout và không phân biệt
    // được "app chết" với "database chết".
    await expect(new HealthService(createDb(queryRaw)).checkDatabase()).resolves.toEqual({
      status: "down",
      latencyMs: null,
    });
  });

  it("latency là null khi down — không báo một con số đo trên kết nối hỏng", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const queryRaw = vi.fn(() => {
      vi.setSystemTime(5000);
      return Promise.reject(new Error("timeout"));
    });

    const result = await new HealthService(createDb(queryRaw)).checkDatabase();

    expect(result.latencyMs).toBeNull();
  });
});
