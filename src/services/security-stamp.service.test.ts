import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { SecurityStampService } from "./security-stamp.service";
import { __clearCache } from "@/lib/cache";

function createDb(passwordChangedAt: Date | null) {
  return {
    user: { findUnique: vi.fn().mockResolvedValue({ passwordChangedAt }) },
  } as unknown as PrismaClient;
}

describe("SecurityStampService", () => {
  beforeEach(async () => {
    await __clearCache();
  });

  it("token cấp SAU khi đổi mật khẩu vẫn hợp lệ", async () => {
    const changedAt = new Date("2026-01-01T00:00:00Z");
    const service = new SecurityStampService(createDb(changedAt));

    const iat = Math.floor(changedAt.getTime() / 1000) + 10;

    await expect(service.isTokenStillValid("u1", iat)).resolves.toBe(true);
  });

  it("token cấp TRƯỚC khi đổi mật khẩu bị từ chối", async () => {
    /*
     * Đây là toàn bộ lý do lớp này tồn tại: JWT không thu hồi được, nên nếu
     * không so `iat` thì kẻ đã chiếm tài khoản còn thao tác thêm 15 phút SAU
     * KHI chủ thật đổi mật khẩu.
     */
    const changedAt = new Date("2026-01-01T00:00:00Z");
    const service = new SecurityStampService(createDb(changedAt));

    const iat = Math.floor(changedAt.getTime() / 1000) - 1;

    await expect(service.isTokenStillValid("u1", iat)).resolves.toBe(false);
  });

  it("token cấp trong CÙNG một giây vẫn được chấp nhận", async () => {
    // `iat` chỉ có độ phân giải giây. Dùng `<=` thì token vừa cấp trong chính
    // luồng đổi mật khẩu (để giữ phiên hiện tại) cũng bị đá ra.
    const changedAt = new Date("2026-01-01T00:00:00.900Z");
    const service = new SecurityStampService(createDb(changedAt));

    await expect(
      service.isTokenStillValid("u1", Math.floor(changedAt.getTime() / 1000)),
    ).resolves.toBe(true);
  });

  it("chưa từng đổi mật khẩu thì mọi token đều hợp lệ", async () => {
    const service = new SecurityStampService(createDb(null));

    await expect(service.isTokenStillValid("u1", 0)).resolves.toBe(true);
  });

  it("cache: lần thứ hai không chạm database", async () => {
    // Phép kiểm này chạy ở MỌI request đã xác thực — một truy vấn mỗi lần là
    // tự thêm một lượt đi database vào đường đi nóng.
    const db = createDb(new Date());
    const service = new SecurityStampService(db);

    await service.stampFor("u1");
    await service.stampFor("u1");

    expect(db.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it("invalidate buộc đọc lại — hiệu lực TỨC THÌ, không đợi TTL", async () => {
    const db = createDb(new Date());
    const service = new SecurityStampService(db);

    await service.stampFor("u1");
    await service.invalidate("u1");
    await service.stampFor("u1");

    expect(db.user.findUnique).toHaveBeenCalledTimes(2);
  });
});
