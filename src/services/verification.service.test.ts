import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { VerificationService } from "./verification.service";
import { hashScopedToken } from "@/lib/opaque-token";
import { TooManyVerificationAttemptsError } from "@/lib/errors";

function createDb(record: unknown, claimedCount = 1) {
  return {
    $transaction: vi.fn().mockResolvedValue([]),
    verificationToken: {
      findUnique: vi.fn().mockResolvedValue(record),
      updateMany: vi.fn().mockResolvedValue({ count: claimedCount }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn(),
    },
  } as unknown as PrismaClient;
}

const valid = (extra: Record<string, unknown> = {}) => ({
  id: "vt-1",
  userId: "u1",
  type: "PASSWORD_RESET",
  destination: null,
  attempts: 0,
  usedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
  ...extra,
});

describe("VerificationService", () => {
  it("cấp token mới thì XOÁ token cũ cùng loại, trong một transaction", async () => {
    // Bấm "gửi lại" ba lần thì chỉ link cuối cùng còn hiệu lực.
    const db = createDb(null);

    await new VerificationService(db).issue("u1", "PASSWORD_RESET");

    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", type: "PASSWORD_RESET", usedAt: null },
    });
  });

  it("OTP điện thoại là 6 chữ số, token qua email thì dài và ngẫu nhiên", async () => {
    const service = new VerificationService(createDb(null));

    const otp = await service.issue("u1", "PHONE_OTP");
    const link = await service.issue("u1", "PASSWORD_RESET");

    expect(otp.token).toMatch(/^\d{6}$/);
    expect(link.token.length).toBeGreaterThan(30);
  });

  it("đổi token hợp lệ lấy userId và đích đến", async () => {
    const service = new VerificationService(createDb(valid({ destination: "moi@example.com" })));

    await expect(service.consume("token", "PASSWORD_RESET")).resolves.toEqual({
      userId: "u1",
      destination: "moi@example.com",
    });
  });

  it("từ chối gọi consume() cho OTP — sai hàm là sai cả cách băm", async () => {
    // Chốt chặn lập trình: `consume()` tra bằng hash TRẦN, mà OTP thì băm kèm
    // userId. Gọi nhầm sẽ không tìm thấy gì (hoặc tệ hơn, tìm thấy của người
    // khác nếu ai đó lỡ băm trần) — nên phải hỏng NGAY và ồn ào.
    const service = new VerificationService(createDb(valid({ type: "PHONE_OTP" })));

    await expect(service.consume("123456", "PHONE_OTP")).rejects.toThrow("consumeOtp");
  });

  it("từ chối token SAI LOẠI", async () => {
    // Không có chốt này thì một link xác thực email dùng được để đặt lại mật khẩu.
    const service = new VerificationService(createDb(valid({ type: "EMAIL_VERIFICATION" })));

    await expect(service.consume("token", "PASSWORD_RESET")).resolves.toBeNull();
  });

  it("từ chối token đã dùng và token hết hạn", async () => {
    const used = new VerificationService(createDb(valid({ usedAt: new Date() })));
    const expired = new VerificationService(
      createDb(valid({ expiresAt: new Date(Date.now() - 1) })),
    );

    await expect(used.consume("t", "PASSWORD_RESET")).resolves.toBeNull();
    await expect(expired.consume("t", "PASSWORD_RESET")).resolves.toBeNull();
  });

  it("hai request song song: chỉ một request giành được token", async () => {
    // `updateMany` với điều kiện `usedAt: null` trả 0 dòng nghĩa là request kia
    // vừa giành trước. Đọc-rồi-ghi thay vì làm thế này là token dùng được hai lần.
    const db = createDb(valid(), 0);

    await expect(new VerificationService(db).consume("t", "PASSWORD_RESET")).resolves.toBeNull();
  });
});

describe("VerificationService — OTP", () => {
  const otpDb = (record: unknown, overrides: Record<string, unknown> = {}) =>
    ({
      $transaction: vi.fn().mockResolvedValue([]),
      verificationToken: {
        findFirst: vi.fn().mockResolvedValue(record),
        findUnique: vi.fn().mockResolvedValue(record),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({ attempts: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn(),
        ...overrides,
      },
    }) as unknown as PrismaClient;

  const otpRecord = (code: string, extra: Record<string, unknown> = {}) => ({
    id: "vt-otp",
    userId: "u1",
    type: "PHONE_OTP" as const,
    destination: "0900000000",
    attempts: 0,
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    // Băm KÈM userId — đây là điểm mấu chốt, xem `hashScopedToken`.
    tokenHash: hashScopedToken("u1:PHONE_OTP", code),
    ...extra,
  });

  it("chấp nhận OTP đúng của ĐÚNG người dùng", async () => {
    const db = otpDb(otpRecord("123456"));

    await expect(new VerificationService(db).consumeOtp("u1", "PHONE_OTP", "123456")).resolves.toBe(
      true,
    );
  });

  it("KHÔNG cho người khác dùng cùng dãy số đó", async () => {
    /*
     * Lỗ hổng cốt lõi mà băm-kèm-userId bịt lại.
     *
     * Với hash trần, `SHA-256("123456")` là một hằng số: A nhập đúng mã của
     * mình mà hệ thống tra ra bản ghi của B, rồi trả về `userId` của B. Ở đây
     * bản ghi thuộc `u1`, nên `u2` nhập đúng dãy số đó vẫn phải trượt.
     */
    const db = otpDb(otpRecord("123456"));

    await expect(new VerificationService(db).consumeOtp("u2", "PHONE_OTP", "123456")).resolves.toBe(
      false,
    );
  });

  it("mã sai làm TĂNG bộ đếm lần thử", async () => {
    const db = otpDb(otpRecord("123456"));

    await new VerificationService(db).consumeOtp("u1", "PHONE_OTP", "000000");

    expect(db.verificationToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { attempts: { increment: 1 } } }),
    );
  });

  it("chạm ngưỡng thì HUỶ mã, không chỉ từ chối lần đó", async () => {
    // Chỉ từ chối mà để mã sống tiếp là kẻ tấn công đợi bộ đếm khác reset rồi
    // dò tiếp — 10^6 khả năng không phải là nhiều với một mã sống 5 phút.
    const db = otpDb(otpRecord("123456", { attempts: 5 }));

    await expect(
      new VerificationService(db).consumeOtp("u1", "PHONE_OTP", "000000"),
    ).rejects.toBeInstanceOf(TooManyVerificationAttemptsError);

    expect(db.verificationToken.updateMany).toHaveBeenCalledWith({
      where: { id: "vt-otp", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it("OTP hết hạn thì trượt", async () => {
    const db = otpDb(otpRecord("123456", { expiresAt: new Date(Date.now() - 1) }));

    await expect(new VerificationService(db).consumeOtp("u1", "PHONE_OTP", "123456")).resolves.toBe(
      false,
    );
  });

  it("lưu `destination` để biết mã đã gửi tới đâu", async () => {
    const db = otpDb(null);

    await new VerificationService(db).issue("u1", "EMAIL_CHANGE", "moi@example.com");

    const created = vi.mocked(db.verificationToken.create).mock.calls[0]![0].data as {
      destination: string;
    };
    expect(created.destination).toBe("moi@example.com");
  });
});
