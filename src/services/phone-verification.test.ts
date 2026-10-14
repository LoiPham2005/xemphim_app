import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { AuthService } from "./auth.service";
import { UserService } from "./user.service";
import { VerificationService } from "./verification.service";
import { TokenService } from "./token.service";
import { SecurityStampService } from "./security-stamp.service";
import { setSmser } from "@/lib/smser";
import { __clearRateLimits } from "@/lib/rate-limit";
import { DuplicateFieldError, PhoneOtpThrottledError } from "@/lib/errors";

/**
 * ⚠️ Test này chạy với `PHONE_VERIFICATION_ENABLED=1` (đặt trong
 * `vitest.config.ts`). Mặc định THẬT của hệ thống là TẮT — xem `config/env.ts`.
 * Bật ở đây để kiểm được phần đáng giá nhất: ba lớp chặn đốt tiền.
 */

const sent: Array<{ to: string; text: string }> = [];

function createDb(overrides: { userFindFirst?: unknown } = {}) {
  return {
    user: {
      findFirst: vi.fn().mockResolvedValue(overrides.userFindFirst ?? null),
      update: vi.fn(),
    },
    verificationToken: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  } as unknown as PrismaClient;
}

function createAuth(db: PrismaClient) {
  return new AuthService(
    db,
    new UserService(db),
    new VerificationService(db),
    new TokenService(db),
    new SecurityStampService(db),
  );
}

describe("Xác thực SĐT — chống đốt tiền", () => {
  beforeEach(async () => {
    sent.length = 0;
    await __clearRateLimits();
    setSmser({
      send: (message) => {
        sent.push(message);
        return Promise.resolve();
      },
    });
  });

  it("gửi được mã lần đầu, và tin nhắn CHỨA mã", async () => {
    await createAuth(createDb()).requestPhoneVerification("u1", "0912345678");

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("0912345678");
    expect(sent[0]!.text).toMatch(/\d{6}/);
  });

  it("GIÃN CÁCH: lần gửi thứ hai ngay sau đó bị chặn", async () => {
    // Chặn "SMS bombing" — nhiều IP cùng dội mã vào một nạn nhân để quấy rối.
    // Rate limit theo IP không cản được vì kẻ tấn công xoay IP.
    const auth = createAuth(createDb());

    await auth.requestPhoneVerification("u1", "0912345678");

    await expect(auth.requestPhoneVerification("u1", "0912345678")).rejects.toBeInstanceOf(
      PhoneOtpThrottledError,
    );
    expect(sent).toHaveLength(1);
  });

  it("giãn cách khoá theo SỐ, không theo người dùng", async () => {
    // Kẻ tấn công tạo được nhiều tài khoản; số điện thoại nạn nhân thì chỉ có
    // một. Khoá theo userId là không chặn được gì.
    const auth = createAuth(createDb());

    await auth.requestPhoneVerification("u1", "0912345678");

    await expect(
      auth.requestPhoneVerification("u2-tai-khoan-khac", "0912345678"),
    ).rejects.toBeInstanceOf(PhoneOtpThrottledError);
  });

  it("CHUẨN HOÁ: +84 và 0 là cùng một số, không lách được trần", async () => {
    // Không chuẩn hoá thì đổi cách viết là gửi thêm được một tin — hoá đơn
    // nhân đôi, và cùng một người đăng ký được hai lần.
    const auth = createAuth(createDb());

    await auth.requestPhoneVerification("u1", "0912345678");

    await expect(auth.requestPhoneVerification("u1", "+84912345678")).rejects.toBeInstanceOf(
      PhoneOtpThrottledError,
    );
  });

  it("số đã có người dùng thì TỪ CHỐI TRƯỚC KHI gửi", async () => {
    // Kiểm trước để không tiêu một tin nhắn cho một số mà cuối cùng vẫn không
    // gắn được.
    const auth = createAuth(createDb({ userFindFirst: { id: "nguoi-khac" } }));

    await expect(auth.requestPhoneVerification("u1", "0912345678")).rejects.toBeInstanceOf(
      DuplicateFieldError,
    );
    expect(sent).toHaveLength(0);
  });

  it("nội dung SMS không dấu — SMS có dấu tốn gấp đôi phí", async () => {
    // Tin nhắn tính phí theo đoạn 160 ký tự, hoặc 70 nếu có ký tự Unicode.
    await createAuth(createDb()).requestPhoneVerification("u1", "0912345678");

    expect(sent[0]!.text).toMatch(/^[\x20-\x7E]+$/);
    expect(sent[0]!.text.length).toBeLessThanOrEqual(160);
  });
});
