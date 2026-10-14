import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { TokenService } from "./token.service";
import { RefreshTokenReuseError } from "@/lib/errors";
import { hashOpaqueToken } from "@/lib/opaque-token";

function createDb(overrides: Record<string, unknown> = {}) {
  return {
    refreshToken: {
      create: vi.fn().mockResolvedValue({ id: "rt-moi" }),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      ...overrides,
    },
  } as unknown as PrismaClient;
}

const activeToken = (extra: Record<string, unknown> = {}) => ({
  id: "rt-cu",
  userId: "u1",
  familyId: "fam-1",
  revokedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
  deviceId: null,
  twoFactorAt: null,
  user: { status: "ACTIVE", deletedAt: null },
  ...extra,
});

describe("TokenService", () => {
  it("chỉ lưu SHA-256 của token, không lưu chuỗi gốc", async () => {
    // Rò database không được đồng nghĩa với rò phiên đăng nhập.
    const db = createDb();
    const issued = await new TokenService(db).issue("u1");

    const written = vi.mocked(db.refreshToken.create).mock.calls[0]![0].data;

    expect(written.tokenHash).toBe(hashOpaqueToken(issued.token));
    expect(JSON.stringify(written)).not.toContain(issued.token);
  });

  it("xoay vòng: token cũ bị thu hồi và token mới được cấp", async () => {
    const db = createDb({ findUnique: vi.fn().mockResolvedValue(activeToken()) });
    const service = new TokenService(db);

    const result = await service.rotate("token-cu");

    expect(result?.userId).toBe("u1");
    expect(db.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rt-cu" } }),
    );
    expect(db.refreshToken.create).toHaveBeenCalled();
  });

  it("dùng lại token ĐÃ THU HỒI thì huỷ đúng MỘT HỌ, không phải mọi phiên", async () => {
    /*
     * Token đã xoay vòng mà còn được dùng lại chỉ có một cách giải thích hợp
     * lý: nó đã bị đánh cắp. Cả kẻ trộm lẫn thiết bị thật đều nằm trong họ đó,
     * nên cả hai cùng bị đá ra — đúng như mong muốn, vì không cách nào biết bên
     * nào là bên nào.
     *
     * Nhưng CHỈ họ đó: đá người dùng ra khỏi cả điện thoại lẫn máy tính chỉ vì
     * một thiết bị bị lộ là phản ứng quá tay, và nó khiến người ta ngại báo sự
     * cố.
     */
    const db = createDb({
      findUnique: vi.fn().mockResolvedValue(activeToken({ revokedAt: new Date() })),
    });
    const service = new TokenService(db);

    await expect(service.rotate("token-da-thu-hoi")).rejects.toBeInstanceOf(RefreshTokenReuseError);

    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: "fam-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("xoay vòng GIỮ NGUYÊN familyId — id phiên ổn định với client", async () => {
    // Không có tính chất này thì id phiên đổi sau mỗi lần refresh, và màn
    // "thiết bị đang đăng nhập" không tự nhận ra chính mình được.
    const db = createDb({ findUnique: vi.fn().mockResolvedValue(activeToken()) });

    const result = await new TokenService(db).rotate("token-cu");

    expect(result?.refresh.familyId).toBe("fam-1");
    const created = vi.mocked(db.refreshToken.create).mock.calls[0]![0].data as {
      familyId: string;
    };
    expect(created.familyId).toBe("fam-1");
  });

  it("xoay vòng mang theo trạng thái đã qua 2FA", async () => {
    // Không mang theo thì mỗi lần refresh lại thành "phiên chưa qua 2FA".
    const twoFactorAt = new Date("2026-01-01T00:00:00Z");
    const db = createDb({
      findUnique: vi.fn().mockResolvedValue(activeToken({ twoFactorAt })),
    });

    await new TokenService(db).rotate("token-cu");

    const created = vi.mocked(db.refreshToken.create).mock.calls[0]![0].data as {
      twoFactorAt: Date;
    };
    expect(created.twoFactorAt).toEqual(twoFactorAt);
  });

  it("phiên MỚI nhận familyId mới, không dùng lại của ai", async () => {
    const db = createDb();
    const service = new TokenService(db);

    const a = await service.issue("u1");
    const b = await service.issue("u1");

    expect(a.familyId).not.toBe(b.familyId);
  });

  it("token hết hạn trả null (không phải lỗi bị đánh cắp)", async () => {
    const db = createDb({
      findUnique: vi.fn().mockResolvedValue(activeToken({ expiresAt: new Date(Date.now() - 1) })),
    });

    await expect(new TokenService(db).rotate("het-han")).resolves.toBeNull();
  });

  it("token không tồn tại trả null", async () => {
    await expect(new TokenService(createDb()).rotate("khong-co")).resolves.toBeNull();
  });

  it("tài khoản bị BANNED không refresh được dù token còn hạn", async () => {
    // Không có chốt này thì tài khoản vừa bị khoá vẫn tự gia hạn phiên vô thời hạn.
    const db = createDb({
      findUnique: vi
        .fn()
        .mockResolvedValue(activeToken({ user: { status: "BANNED", deletedAt: null } })),
    });

    await expect(new TokenService(db).rotate("token")).resolves.toBeNull();
  });

  it("revokeById ràng buộc userId ngay trong where", async () => {
    // Id phiên đến từ client. Thiếu ràng buộc này là ai cũng đăng xuất được
    // thiết bị của người khác chỉ bằng cách đoán id.
    const db = createDb({ updateMany: vi.fn().mockResolvedValue({ count: 1 }) });

    await new TokenService(db).revokeById("fam-1", "u1");

    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: "fam-1", userId: "u1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("listActive gộp theo họ — một thiết bị chỉ hiện một dòng", async () => {
    // Mỗi lần refresh sinh một dòng mới. Không gộp thì một chiếc điện thoại
    // dùng một tháng sẽ xuất hiện thành hàng trăm "thiết bị".
    const now = new Date();
    const db = createDb({
      findMany: vi.fn().mockResolvedValue([
        { familyId: "fam-1", userAgent: "iPhone", ip: "1.1.1.1", createdAt: now, expiresAt: now },
        { familyId: "fam-1", userAgent: "iPhone", ip: "1.1.1.1", createdAt: now, expiresAt: now },
        { familyId: "fam-2", userAgent: "Chrome", ip: "2.2.2.2", createdAt: now, expiresAt: now },
      ]),
    });

    const sessions = await new TokenService(db).listActive("u1");

    expect(sessions).toHaveLength(2);
    expect(sessions.map((item) => item.id)).toEqual(["fam-1", "fam-2"]);
  });

  it("revokeById trả false khi không thu hồi được gì", async () => {
    const db = createDb({ updateMany: vi.fn().mockResolvedValue({ count: 0 }) });

    await expect(new TokenService(db).revokeById("rt-cua-nguoi-khac", "u1")).resolves.toBe(false);
  });

  it("revokeAllForUser giữ lại được phiên hiện tại", async () => {
    // Đổi mật khẩu mà đăng xuất luôn thiết bị đang thao tác thì trông y như lỗi.
    const db = createDb();

    await new TokenService(db).revokeAllForUser("u1", { exceptFamilyId: "fam-hien-tai" });

    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", revokedAt: null, NOT: { familyId: "fam-hien-tai" } },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
