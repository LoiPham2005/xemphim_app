import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OAuthService } from "./oauth.service";
import { UserService } from "./user.service";
import { AccountBannedError, AccountInactiveError } from "@/lib/errors";

const USER_ROW = {
  id: "u1",
  email: "loi@gmail.com",
  phone: null,
  username: null,
  status: "ACTIVE" as const,
  emailVerifiedAt: new Date(),
  twoFactorEnabledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  profile: null,
  userRoles: [],
};

function createDb(overrides: Record<string, unknown> = {}) {
  return {
    oAuthAccount: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue(USER_ROW),
      create: vi.fn().mockResolvedValue(USER_ROW),
      findUniqueOrThrow: vi.fn(),
    },
    ...overrides,
  } as unknown as PrismaClient;
}

const profile = (email: string | null) => ({
  provider: "google" as const,
  providerAccountId: "g-1",
  email,
  fullName: "Loi",
});

describe("OAuthService", () => {
  it("chuẩn hoá email trước khi tra cứu — KHÔNG tạo tài khoản trùng", async () => {
    /*
     * Google trả về đúng thứ người dùng đã gõ khi đăng ký, kể cả `Loi@Gmail.com`.
     * Database thì luôn lưu chữ thường. Không chuẩn hoá thì tra không ra tài
     * khoản cũ → tạo tài khoản MỚI, và người dùng mất sạch dữ liệu cũ.
     */
    const db = createDb();
    const service = new OAuthService(db, new UserService(db));

    await service.loginWithProfile(profile("Loi@Gmail.COM"));

    const where = vi.mocked(db.user.findFirst).mock.calls[0]![0]!.where as { email: string };
    expect(where.email).toBe("loi@gmail.com");
    // Tìm thấy tài khoản cũ → liên kết, KHÔNG tạo mới.
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.oAuthAccount.create).toHaveBeenCalled();
  });

  it("chặn tài khoản BANNED và INACTIVE ở đường OAuth", async () => {
    for (const [status, error] of [
      ["BANNED", AccountBannedError],
      ["INACTIVE", AccountInactiveError],
    ] as const) {
      const db = createDb({
        user: {
          findFirst: vi.fn().mockResolvedValue({ ...USER_ROW, status }),
          create: vi.fn(),
        },
      });

      await expect(
        new OAuthService(db, new UserService(db)).loginWithProfile(profile("loi@gmail.com")),
      ).rejects.toBeInstanceOf(error);
    }
  });
});
