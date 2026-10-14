import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { hash as argon2Hash } from "@node-rs/argon2";
import { AuthService } from "./auth.service";
import type { UserService } from "./user.service";
import type { VerificationService } from "./verification.service";
import type { TokenService } from "./token.service";
import type { SecurityStampService } from "./security-stamp.service";
import { CryptoUtils } from "@/lib/crypto";
import { env } from "@/lib/env";
import {
  AccountBannedError,
  AccountInactiveError,
  AccountLockedError,
  DuplicateFieldError,
  InvalidCredentialsError,
  InvalidVerificationTokenError,
  PhoneOtpThrottledError,
  PhoneVerificationDisabledError,
  TwoFactorRequiredError,
} from "@/lib/errors";
import type * as EmailsModule from "@/lib/emails";
import type * as SmserModule from "@/lib/smser";
import type * as RateLimitModule from "@/lib/rate-limit";
import type * as LoggerModule from "@/lib/logger";

/*
 * Module ngoài được thay bằng hàm giả: test này kiểm LUẬT của luồng xác thực,
 * không kiểm việc thư có thật sự tới hộp thư hay SMS có thật sự tốn tiền.
 *
 * Mật khẩu thì KHÔNG giả — băm Argon2 thật. Phần lớn luật bảo mật ở đây xoay
 * quanh "mật khẩu đúng hay sai", giả nó đi là test đang kiểm chính cái giả.
 */
const mocks = vi.hoisted(() => ({
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendPasswordChangedEmail: vi.fn(),
  sendEmailChangeVerificationEmail: vi.fn(),
  sendEmailChangeNoticeEmail: vi.fn(),
  sendPhoneOtpSms: vi.fn(),
  isPhoneVerificationEnabled: vi.fn(),
  rateLimit: vi.fn(),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/emails", async (importOriginal) => ({
  ...(await importOriginal<typeof EmailsModule>()),
  sendVerificationEmail: mocks.sendVerificationEmail,
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
  sendPasswordChangedEmail: mocks.sendPasswordChangedEmail,
  sendEmailChangeVerificationEmail: mocks.sendEmailChangeVerificationEmail,
  sendEmailChangeNoticeEmail: mocks.sendEmailChangeNoticeEmail,
}));
vi.mock("@/lib/sms", () => ({ sendPhoneOtpSms: mocks.sendPhoneOtpSms }));
vi.mock("@/lib/smser", async (importOriginal) => ({
  ...(await importOriginal<typeof SmserModule>()),
  isPhoneVerificationEnabled: mocks.isPhoneVerificationEnabled,
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof RateLimitModule>()),
  rateLimit: mocks.rateLimit,
}));
vi.mock("@/lib/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logger: mocks.logger,
}));

const PASSWORD = "MatKhau@123";
const WRONG_PASSWORD = "SaiMatKhau@999";

/** Hash theo tham số hiện hành — đăng nhập đúng KHÔNG cần băm lại. */
let CURRENT_HASH: string;
/** Hash Argon2id với tham số CŨ (yếu hơn) — đăng nhập đúng phải được nâng cấp. */
let OLD_PARAMS_HASH: string;

beforeAll(async () => {
  CURRENT_HASH = await CryptoUtils.hashPassword(PASSWORD);
  OLD_PARAMS_HASH = await argon2Hash(PASSWORD, {
    algorithm: 2,
    memoryCost: 4096,
    timeCost: 1,
    parallelism: 1,
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mocks.sendVerificationEmail.mockResolvedValue(undefined);
  mocks.sendPasswordResetEmail.mockResolvedValue(undefined);
  mocks.sendPasswordChangedEmail.mockResolvedValue(undefined);
  mocks.sendEmailChangeVerificationEmail.mockResolvedValue(undefined);
  mocks.sendEmailChangeNoticeEmail.mockResolvedValue(undefined);
  mocks.sendPhoneOtpSms.mockResolvedValue(undefined);
  mocks.isPhoneVerificationEnabled.mockReturnValue(true);
  mocks.rateLimit.mockResolvedValue({
    success: true,
    remaining: 0,
    limit: 1,
    retryAfterSeconds: 0,
  });
});

const PUBLIC_USER = {
  id: "u1",
  email: "a@b.com",
  phone: null,
  username: "nguyenvana",
  status: "ACTIVE" as const,
  emailVerifiedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  fullName: "Nguyễn Văn A",
  avatarUrl: null,
  roles: ["USER"],
  twoFactorEnabled: false,
};

/** Bản ghi đúng hình dạng `select` của `validateCredentials`. */
function loginRow(extra: Record<string, unknown> = {}) {
  return {
    id: "u1",
    email: "a@b.com",
    phone: null,
    username: "nguyenvana",
    password: CURRENT_HASH,
    status: "ACTIVE",
    emailVerifiedAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    twoFactorEnabledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    profile: { fullName: "Nguyễn Văn A", avatarUrl: null, avatarFile: null },
    userRoles: [{ role: { key: "USER" } }],
    ...extra,
  };
}

function createDb(
  overrides: { user?: Record<string, unknown>; verificationToken?: Record<string, unknown> } = {},
) {
  return {
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ id: "u1", email: "a@b.com", failedLoginAttempts: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      ...overrides.user,
    },
    verificationToken: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.verificationToken,
    },
  } as unknown as PrismaClient;
}

/** Các service phụ thuộc, giả hết — chỉ cần biết chúng được gọi thế nào. */
function createDeps() {
  return {
    users: {
      create: vi.fn().mockResolvedValue(PUBLIC_USER),
      findById: vi.fn().mockResolvedValue(PUBLIC_USER),
      findByEmail: vi.fn().mockResolvedValue(null),
    },
    verification: {
      issue: vi.fn().mockResolvedValue({ token: "token-gui-di" }),
      consume: vi.fn().mockResolvedValue(null),
      consumeOtp: vi.fn().mockResolvedValue(false),
    },
    tokens: { revokeAllForUser: vi.fn().mockResolvedValue(0) },
    securityStamp: { invalidate: vi.fn().mockResolvedValue(undefined) },
  };
}

function createAuth(db: PrismaClient, deps = createDeps()) {
  const service = new AuthService(
    db,
    deps.users as unknown as UserService,
    deps.verification as unknown as VerificationService,
    deps.tokens as unknown as TokenService,
    deps.securityStamp as unknown as SecurityStampService,
  );
  return { service, ...deps };
}

/** Bắt lỗi ném ra để so sánh nhiều thuộc tính cùng lúc. */
async function catchError(promise: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await promise;
  } catch (error) {
    return error as Error & { code?: string };
  }
  throw new Error("Đáng lẽ phải ném lỗi");
}

describe("AuthService", () => {
  // -------------------------------------------------------------------------
  describe("validateCredentials — đăng nhập", () => {
    it("đúng mật khẩu thì trả hồ sơ công khai, KHÔNG kèm hash mật khẩu hay bộ đếm sai", async () => {
      const db = createDb({ user: { findFirst: vi.fn().mockResolvedValue(loginRow()) } });

      const user = await createAuth(db).service.validateCredentials({
        identifier: "a@b.com",
        password: PASSWORD,
      });

      expect(user.id).toBe("u1");
      expect(user.roles).toEqual(["USER"]);
      expect(user).not.toHaveProperty("password");
      expect(user).not.toHaveProperty("failedLoginAttempts");
      expect(JSON.stringify(user)).not.toContain(CURRENT_HASH);
    });

    it("ô nhập có `@` thì tra theo EMAIL, đã trim + chữ thường, và bỏ qua tài khoản xoá mềm", async () => {
      // Không chuẩn hoá thì "A@B.com " không đăng nhập được dù đã đăng ký
      // đúng địa chỉ đó.
      const db = createDb({ user: { findFirst: vi.fn().mockResolvedValue(loginRow()) } });

      await createAuth(db).service.validateCredentials({
        identifier: "  A@B.Com ",
        password: PASSWORD,
      });

      const where = vi.mocked(db.user.findFirst).mock.calls[0]![0]!.where;
      expect(where).toEqual({ deletedAt: null, email: "a@b.com" });
    });

    it("ô nhập KHÔNG có `@` thì tra theo USERNAME, cùng một ô nhập", async () => {
      // `usernameSchema` cấm `@`, nên đây là cách phân biệt duy nhất mà không
      // bắt người dùng nhớ mình đã đăng ký bằng đường nào.
      const db = createDb({ user: { findFirst: vi.fn().mockResolvedValue(loginRow()) } });

      await createAuth(db).service.validateCredentials({
        identifier: "NguyenVanA",
        password: PASSWORD,
      });

      const where = vi.mocked(db.user.findFirst).mock.calls[0]![0]!.where;
      expect(where).toEqual({ deletedAt: null, username: "nguyenvana" });
    });

    it("tài khoản đã xoá mềm không đăng nhập được — truy vấn không trả về nên lỗi y như không tồn tại", async () => {
      // `deletedAt: null` nằm TRONG câu truy vấn: bản ghi xoá mềm không bao
      // giờ tới được bước so mật khẩu, kể cả khi mật khẩu đúng.
      const db = createDb();

      await expect(
        createAuth(db).service.validateCredentials({ identifier: "a@b.com", password: PASSWORD }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
      expect(vi.mocked(db.user.findFirst).mock.calls[0]![0]!.where).toMatchObject({
        deletedAt: null,
      });
    });

    it("ba lý do hỏng — không tồn tại, chưa đặt mật khẩu, sai mật khẩu — trả CÙNG một lỗi", async () => {
      // Khác nhau dù chỉ một chữ trong thông điệp là đủ để dò ra email nào đã
      // đăng ký.
      const khongTonTai = createDb();
      const chuaDatMatKhau = createDb({
        user: { findFirst: vi.fn().mockResolvedValue(loginRow({ password: null })) },
      });
      const saiMatKhau = createDb({
        user: { findFirst: vi.fn().mockResolvedValue(loginRow()) },
      });

      const errors = await Promise.all([
        catchError(
          createAuth(khongTonTai).service.validateCredentials({
            identifier: "x@y.com",
            password: PASSWORD,
          }),
        ),
        catchError(
          createAuth(chuaDatMatKhau).service.validateCredentials({
            identifier: "a@b.com",
            password: PASSWORD,
          }),
        ),
        catchError(
          createAuth(saiMatKhau).service.validateCredentials({
            identifier: "a@b.com",
            password: WRONG_PASSWORD,
          }),
        ),
      ]);

      for (const error of errors) {
        expect(error).toBeInstanceOf(InvalidCredentialsError);
        expect(error.code).toBe(errors[0].code);
        expect(error.message).toBe(errors[0].message);
      }
    });

    it("không tìm thấy tài khoản vẫn đốt thời gian một lần so Argon2 — chống dò bằng đồng hồ", async () => {
      // Trả lỗi ngay lập tức thì nhanh hơn hẳn nhánh "sai mật khẩu", và độ
      // chênh thời gian đó tự nó là câu trả lời "email này chưa đăng ký".
      const fakeCompare = vi.spyOn(CryptoUtils, "fakeCompare");
      const db = createDb();

      await expect(
        createAuth(db).service.validateCredentials({ identifier: "x@y.com", password: PASSWORD }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);

      expect(fakeCompare).toHaveBeenCalledWith(PASSWORD);
    });

    it("tài khoản chưa đặt mật khẩu (OAuth/admin tạo hộ) cũng đốt thời gian giả, không ghi bộ đếm", async () => {
      const fakeCompare = vi.spyOn(CryptoUtils, "fakeCompare");
      const db = createDb({
        user: { findFirst: vi.fn().mockResolvedValue(loginRow({ password: null })) },
      });

      await expect(
        createAuth(db).service.validateCredentials({ identifier: "a@b.com", password: PASSWORD }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);

      expect(fakeCompare).toHaveBeenCalledOnce();
      expect(db.user.update).not.toHaveBeenCalled();
    });

    describe("khoá tạm sau N lần sai liên tiếp", () => {
      it("sai mật khẩu thì tăng bộ đếm bằng `increment` nguyên tử, chưa khoá khi chưa chạm ngưỡng", async () => {
        // `increment` chứ không phải đọc-cộng-ghi: nhiều IP dò cùng lúc mà
        // cộng ở tầng ứng dụng thì các lần sai đè lên nhau, bộ đếm không
        // bao giờ chạm ngưỡng.
        const db = createDb({
          user: {
            findFirst: vi.fn().mockResolvedValue(loginRow()),
            update: vi.fn().mockResolvedValue({ failedLoginAttempts: 1 }),
          },
        });

        await expect(
          createAuth(db).service.validateCredentials({
            identifier: "a@b.com",
            password: WRONG_PASSWORD,
          }),
        ).rejects.toBeInstanceOf(InvalidCredentialsError);

        expect(db.user.update).toHaveBeenCalledOnce();
        expect(vi.mocked(db.user.update).mock.calls[0]![0]).toMatchObject({
          where: { id: "u1" },
          data: { failedLoginAttempts: { increment: 1 } },
        });
      });

      it("lần sai thứ N thì khoá đúng LOGIN_LOCKOUT_MINUTES phút và đưa bộ đếm về 0", async () => {
        const db = createDb({
          user: {
            findFirst: vi
              .fn()
              .mockResolvedValue(
                loginRow({ failedLoginAttempts: env.LOGIN_MAX_FAILED_ATTEMPTS - 1 }),
              ),
            update: vi
              .fn()
              .mockResolvedValue({ failedLoginAttempts: env.LOGIN_MAX_FAILED_ATTEMPTS }),
          },
        });
        const before = Date.now();

        const error = await catchError(
          createAuth(db).service.validateCredentials({
            identifier: "a@b.com",
            password: WRONG_PASSWORD,
          }),
        );

        // Lần sai chạm ngưỡng VẪN trả lỗi chung — báo "đã khoá" ngay lúc này
        // là xác nhận cho kẻ dò rằng tài khoản có tồn tại.
        expect(error).toBeInstanceOf(InvalidCredentialsError);
        expect(db.user.update).toHaveBeenCalledTimes(2);
        const lockData = vi.mocked(db.user.update).mock.calls[1]![0].data as {
          failedLoginAttempts: number;
          lockedUntil: Date;
        };
        expect(lockData.failedLoginAttempts).toBe(0);
        const lockMs = env.LOGIN_LOCKOUT_MINUTES * 60 * 1000;
        expect(lockData.lockedUntil.getTime()).toBeGreaterThanOrEqual(before + lockMs);
        expect(lockData.lockedUntil.getTime()).toBeLessThanOrEqual(Date.now() + lockMs);
      });

      it("đang bị khoá mà nhập sai thì KHÔNG tăng bộ đếm và KHÔNG đẩy lùi `lockedUntil`", async () => {
        // Nếu không, một loạt request dồn tới trong lúc khoá sẽ gia hạn khoá
        // mãi mãi — kẻ tấn công biến cơ chế bảo vệ thành công cụ khoá chủ
        // tài khoản ra ngoài.
        const lockedUntil = new Date(Date.now() + 10 * 60_000);
        const db = createDb({
          user: { findFirst: vi.fn().mockResolvedValue(loginRow({ lockedUntil })) },
        });

        await expect(
          createAuth(db).service.validateCredentials({
            identifier: "a@b.com",
            password: WRONG_PASSWORD,
          }),
        ).rejects.toBeInstanceOf(AccountLockedError);

        expect(db.user.update).not.toHaveBeenCalled();
      });

      it("đang bị khoá thì sai hay ĐÚNG mật khẩu đều nhận CÙNG lỗi khoá — không lộ đoán trúng", async () => {
        // Bản cũ: sai -> 401, đúng -> 423. Kẻ dò từ nhiều IP biết mình đoán TRÚNG ngay giữa lúc khoá,
        // đợi hết khoá là vào — khoá tạm mất đúng mục đích. Giờ lúc khoá KHÔNG kiểm mật khẩu nữa.
        const verify = vi.spyOn(CryptoUtils, "verifyPassword");
        const row = loginRow({ lockedUntil: new Date(Date.now() + 60_000) });
        const db = createDb({ user: { findFirst: vi.fn().mockResolvedValue(row) } });
        const { service } = createAuth(db);

        const wrong = await catchError(
          service.validateCredentials({ identifier: "a@b.com", password: WRONG_PASSWORD }),
        );
        const right = await catchError(
          service.validateCredentials({ identifier: "a@b.com", password: PASSWORD }),
        );

        expect(wrong).toBeInstanceOf(AccountLockedError);
        expect(right).toBeInstanceOf(AccountLockedError);
        expect(verify).not.toHaveBeenCalled();
      });

      it("đang bị khoá thì đúng mật khẩu cũng KHÔNG vào được — báo khoá kèm thời điểm mở", async () => {
        const lockedUntil = new Date(Date.now() + 5 * 60_000);
        const db = createDb({
          user: { findFirst: vi.fn().mockResolvedValue(loginRow({ lockedUntil })) },
        });

        const error = await catchError(
          createAuth(db).service.validateCredentials({
            identifier: "a@b.com",
            password: PASSWORD,
          }),
        );

        expect(error).toBeInstanceOf(AccountLockedError);
        expect((error as AccountLockedError).lockedUntil).toEqual(lockedUntil);
        // Không được coi là đăng nhập thành công: bộ đếm và khoá giữ nguyên.
        expect(db.user.update).not.toHaveBeenCalled();
      });

      it("khoá đã HẾT HẠN thì đúng mật khẩu đăng nhập được và dọn sạch dấu vết khoá", async () => {
        const db = createDb({
          user: {
            findFirst: vi
              .fn()
              .mockResolvedValue(
                loginRow({ lockedUntil: new Date(Date.now() - 1000), failedLoginAttempts: 2 }),
              ),
          },
        });

        const user = await createAuth(db).service.validateCredentials({
          identifier: "a@b.com",
          password: PASSWORD,
        });

        expect(user.id).toBe("u1");
        expect(db.user.update).toHaveBeenCalledWith({
          where: { id: "u1" },
          data: { failedLoginAttempts: 0, lockedUntil: null },
        });
      });

      it("khoá đã hết hạn mà vẫn nhập sai thì bắt đầu đếm lại như bình thường", async () => {
        const db = createDb({
          user: {
            findFirst: vi
              .fn()
              .mockResolvedValue(loginRow({ lockedUntil: new Date(Date.now() - 1000) })),
          },
        });

        await expect(
          createAuth(db).service.validateCredentials({
            identifier: "a@b.com",
            password: WRONG_PASSWORD,
          }),
        ).rejects.toBeInstanceOf(InvalidCredentialsError);

        expect(vi.mocked(db.user.update).mock.calls[0]![0].data).toEqual({
          failedLoginAttempts: { increment: 1 },
        });
      });

      it("đúng mật khẩu sau vài lần gõ nhầm thì RESET bộ đếm về 0", async () => {
        // Không reset thì ba lần gõ nhầm tuần trước cộng hai lần hôm nay là
        // bị khoá — phạt người dùng vì những lỗi đã qua.
        const db = createDb({
          user: { findFirst: vi.fn().mockResolvedValue(loginRow({ failedLoginAttempts: 3 })) },
        });

        await createAuth(db).service.validateCredentials({
          identifier: "a@b.com",
          password: PASSWORD,
        });

        expect(db.user.update).toHaveBeenCalledWith({
          where: { id: "u1" },
          data: { failedLoginAttempts: 0, lockedUntil: null },
        });
      });

      it("bộ đếm đang là 0 thì đăng nhập đúng không ghi database thừa", async () => {
        const db = createDb({ user: { findFirst: vi.fn().mockResolvedValue(loginRow()) } });

        await createAuth(db).service.validateCredentials({
          identifier: "a@b.com",
          password: PASSWORD,
        });

        expect(db.user.update).not.toHaveBeenCalled();
      });
    });

    describe("trạng thái tài khoản", () => {
      it("BANNED + đúng mật khẩu thì bị chặn bằng lỗi riêng", async () => {
        const db = createDb({
          user: { findFirst: vi.fn().mockResolvedValue(loginRow({ status: "BANNED" })) },
        });

        await expect(
          createAuth(db).service.validateCredentials({ identifier: "a@b.com", password: PASSWORD }),
        ).rejects.toBeInstanceOf(AccountBannedError);
      });

      it("INACTIVE + đúng mật khẩu thì bị chặn", async () => {
        const db = createDb({
          user: { findFirst: vi.fn().mockResolvedValue(loginRow({ status: "INACTIVE" })) },
        });

        await expect(
          createAuth(db).service.validateCredentials({ identifier: "a@b.com", password: PASSWORD }),
        ).rejects.toBeInstanceOf(AccountInactiveError);
      });

      it("BANNED + SAI mật khẩu thì chỉ nhận lỗi chung — trạng thái chỉ lộ sau khi mật khẩu đúng", async () => {
        // Lộ trước là oracle: kẻ dò mù biết ngay tài khoản nào tồn tại và đã
        // bị khoá, mà chưa cần đoán trúng gì.
        const db = createDb({
          user: { findFirst: vi.fn().mockResolvedValue(loginRow({ status: "BANNED" })) },
        });

        const error = await catchError(
          createAuth(db).service.validateCredentials({
            identifier: "a@b.com",
            password: WRONG_PASSWORD,
          }),
        );

        expect(error).toBeInstanceOf(InvalidCredentialsError);
      });

      it("tài khoản bị chặn thì KHÔNG reset bộ đếm sai — chặn xảy ra trước bước dọn dấu vết", async () => {
        const db = createDb({
          user: {
            findFirst: vi
              .fn()
              .mockResolvedValue(loginRow({ status: "BANNED", failedLoginAttempts: 2 })),
          },
        });

        await expect(
          createAuth(db).service.validateCredentials({ identifier: "a@b.com", password: PASSWORD }),
        ).rejects.toBeInstanceOf(AccountBannedError);
        expect(db.user.update).not.toHaveBeenCalled();
      });
    });

    describe("cổng 2FA", () => {
      it("tài khoản bật 2FA thì đúng mật khẩu cũng KHÔNG nhận user — ném TwoFactorRequiredError kèm userId", async () => {
        // Ném lỗi thay vì trả cờ: nơi gọi không thể "quên" xử lý exception,
        // còn quên đọc một trường `twoFactorRequired` là 2FA bị bỏ qua sạch.
        // Route bắt lỗi này để cấp challenge token.
        const db = createDb({
          user: {
            findFirst: vi.fn().mockResolvedValue(loginRow({ twoFactorEnabledAt: new Date() })),
          },
        });

        const error = await catchError(
          createAuth(db).service.validateCredentials({
            identifier: "a@b.com",
            password: PASSWORD,
          }),
        );

        expect(error).toBeInstanceOf(TwoFactorRequiredError);
        expect((error as TwoFactorRequiredError).userId).toBe("u1");
        expect(error.code).toBe("TWO_FACTOR_REQUIRED");
      });

      it("bật 2FA mà SAI mật khẩu thì chỉ nhận lỗi chung — không lộ ai đã bật 2FA", async () => {
        const db = createDb({
          user: {
            findFirst: vi.fn().mockResolvedValue(loginRow({ twoFactorEnabledAt: new Date() })),
          },
        });

        const error = await catchError(
          createAuth(db).service.validateCredentials({
            identifier: "a@b.com",
            password: WRONG_PASSWORD,
          }),
        );

        expect(error).toBeInstanceOf(InvalidCredentialsError);
      });

      it("tài khoản BANNED có 2FA thì bị chặn ở trạng thái, không bao giờ tới bước hỏi mã", async () => {
        const db = createDb({
          user: {
            findFirst: vi
              .fn()
              .mockResolvedValue(loginRow({ status: "BANNED", twoFactorEnabledAt: new Date() })),
          },
        });

        await expect(
          createAuth(db).service.validateCredentials({ identifier: "a@b.com", password: PASSWORD }),
        ).rejects.toBeInstanceOf(AccountBannedError);
      });
    });

    describe("nâng cấp hash mật khẩu", () => {
      it("hash băm bằng tham số CŨ thì được băm lại theo tham số hiện hành sau khi đúng mật khẩu", async () => {
        const db = createDb({
          user: { findFirst: vi.fn().mockResolvedValue(loginRow({ password: OLD_PARAMS_HASH })) },
        });

        await createAuth(db).service.validateCredentials({
          identifier: "a@b.com",
          password: PASSWORD,
        });

        const data = vi.mocked(db.user.update).mock.calls[0]![0].data as { password: string };
        expect(data.password).not.toBe(OLD_PARAMS_HASH);
        expect(data.password).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
        expect((await CryptoUtils.verifyPassword(PASSWORD, data.password)).valid).toBe(true);
      });

      it("nâng cấp hash hỏng thì vẫn cho đăng nhập — chỉ ghi log", async () => {
        // Người dùng vừa nhập đúng mật khẩu; chặn họ vì một việc bảo trì nền
        // thất bại là sai.
        const db = createDb({
          user: {
            findFirst: vi.fn().mockResolvedValue(loginRow({ password: OLD_PARAMS_HASH })),
            update: vi.fn().mockRejectedValue(new Error("db sập")),
          },
        });

        const user = await createAuth(db).service.validateCredentials({
          identifier: "a@b.com",
          password: PASSWORD,
        });

        expect(user.id).toBe("u1");
        expect(mocks.logger.error).toHaveBeenCalledWith(
          "Không nâng cấp được hash mật khẩu",
          expect.any(Error),
          { userId: "u1" },
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("completeTwoFactorLogin", () => {
    it("đã qua 2FA thì trả hồ sơ người dùng", async () => {
      const { service, users } = createAuth(createDb());

      await expect(service.completeTwoFactorLogin("u1")).resolves.toEqual(PUBLIC_USER);
      expect(users.findById).toHaveBeenCalledWith("u1");
    });

    it("tài khoản biến mất giữa hai bước (bị xoá) thì trả lỗi đăng nhập chung", async () => {
      const deps = createDeps();
      deps.users.findById.mockResolvedValue(null);

      await expect(
        createAuth(createDb(), deps).service.completeTwoFactorLogin("u1"),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it("bị khoá trong vài giây giữa bước mật khẩu và bước nhập mã thì vẫn bị chặn", async () => {
      const deps = createDeps();
      deps.users.findById.mockResolvedValue({ ...PUBLIC_USER, status: "BANNED" });

      await expect(
        createAuth(createDb(), deps).service.completeTwoFactorLogin("u1"),
      ).rejects.toBeInstanceOf(AccountBannedError);
    });
  });

  // -------------------------------------------------------------------------
  describe("register — đăng ký công khai", () => {
    it("vai trò LUÔN là USER, kể cả khi body cố nhét roleKeys ADMIN", async () => {
      // Đọc vai trò từ input là để bất kỳ ai gọi POST /auth/register tự
      // phong mình làm ADMIN.
      const { service, users } = createAuth(createDb());
      const input = {
        email: "moi@b.com",
        password: PASSWORD,
        username: "moi",
        fullName: "Người Mới",
        roleKeys: ["ADMIN"],
        status: "BANNED",
      };

      await service.register(input);

      expect(users.create).toHaveBeenCalledWith({
        email: "moi@b.com",
        password: PASSWORD,
        username: "moi",
        fullName: "Người Mới",
        status: "ACTIVE",
        roleKeys: ["USER"],
      });
    });

    it("đăng ký xong thì gửi thư xác thực email", async () => {
      const db = createDb({
        user: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: "u1", email: "a@b.com", emailVerifiedAt: null }),
        },
      });
      const { service, verification } = createAuth(db);

      await service.register({ email: "a@b.com", password: PASSWORD });

      expect(verification.issue).toHaveBeenCalledWith("u1", "EMAIL_VERIFICATION");
      expect(mocks.sendVerificationEmail).toHaveBeenCalledWith("a@b.com", "token-gui-di");
    });

    it("gửi thư xác thực hỏng thì đăng ký VẪN thành công — tài khoản đã tạo rồi", async () => {
      // Báo "đăng ký thất bại" cho một thao tác thật ra đã thành công là
      // người dùng đăng ký lại, rồi vấp lỗi "email đã được sử dụng".
      const db = createDb({
        user: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: "u1", email: "a@b.com", emailVerifiedAt: null }),
        },
      });
      mocks.sendVerificationEmail.mockRejectedValue(new Error("SMTP chết"));

      const user = await createAuth(db).service.register({ email: "a@b.com", password: PASSWORD });

      expect(user).toEqual(PUBLIC_USER);
      expect(mocks.logger.error).toHaveBeenCalledWith(
        "Không gửi được email xác thực sau khi đăng ký",
        expect.any(Error),
        { userId: "u1" },
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("xác thực email", () => {
    it("sendEmailVerification: email đã xác thực thì KHÔNG cấp token mới", async () => {
      // Cấp mới là vô hiệu token cũ — bấm nhầm "gửi lại" không được làm hỏng
      // trạng thái đang đúng.
      const db = createDb({
        user: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: "u1", email: "a@b.com", emailVerifiedAt: new Date() }),
        },
      });
      const { service, verification } = createAuth(db);

      await service.sendEmailVerification("u1");

      expect(verification.issue).not.toHaveBeenCalled();
      expect(mocks.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it("sendEmailVerification: bỏ qua tài khoản đã xoá mềm hoặc không có email", async () => {
      const db = createDb({
        user: {
          findFirst: vi.fn().mockResolvedValue({ id: "u1", email: null, emailVerifiedAt: null }),
        },
      });
      const { service, verification } = createAuth(db);

      await service.sendEmailVerification("u1");

      expect(vi.mocked(db.user.findFirst).mock.calls[0]![0]!.where).toEqual({
        id: "u1",
        deletedAt: null,
      });
      expect(verification.issue).not.toHaveBeenCalled();
    });

    it("resendEmailVerification: email không tồn tại thì im lặng, không ném lỗi", async () => {
      // Endpoint công khai — khác biệt nào cũng biến nó thành máy dò danh
      // sách người dùng.
      const { service, verification } = createAuth(createDb());

      await expect(service.resendEmailVerification("khong-co@b.com")).resolves.toBeUndefined();
      expect(verification.issue).not.toHaveBeenCalled();
    });

    it("resendEmailVerification: email tồn tại và chưa xác thực thì gửi lại", async () => {
      const db = createDb({
        user: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: "u1", email: "a@b.com", emailVerifiedAt: null }),
        },
      });
      const deps = createDeps();
      deps.users.findByEmail.mockResolvedValue(PUBLIC_USER);

      await expect(
        createAuth(db, deps).service.resendEmailVerification("a@b.com"),
      ).resolves.toBeUndefined();
      expect(mocks.sendVerificationEmail).toHaveBeenCalledWith("a@b.com", "token-gui-di");
    });

    it("verifyEmail: token sai/hết hạn thì ném lỗi và không ghi gì", async () => {
      const db = createDb();

      await expect(createAuth(db).service.verifyEmail("rac")).rejects.toBeInstanceOf(
        InvalidVerificationTokenError,
      );
      expect(db.user.updateMany).not.toHaveBeenCalled();
    });

    it("verifyEmail: chỉ ghi `emailVerifiedAt` khi nó đang null — bấm lại link cũ không đè mốc gốc", async () => {
      const db = createDb();
      const deps = createDeps();
      deps.verification.consume.mockResolvedValue({ userId: "u1", destination: null });

      const user = await createAuth(db, deps).service.verifyEmail("tok");

      expect(deps.verification.consume).toHaveBeenCalledWith("tok", "EMAIL_VERIFICATION");
      expect(db.user.updateMany).toHaveBeenCalledWith({
        where: { id: "u1", emailVerifiedAt: null },
        data: { emailVerifiedAt: expect.any(Date) },
      });
      expect(user).toEqual(PUBLIC_USER);
    });

    it("verifyEmail: tài khoản đã biến mất sau khi tiêu token thì báo token không hợp lệ", async () => {
      const deps = createDeps();
      deps.verification.consume.mockResolvedValue({ userId: "u1", destination: null });
      deps.users.findById.mockResolvedValue(null);

      await expect(createAuth(createDb(), deps).service.verifyEmail("tok")).rejects.toBeInstanceOf(
        InvalidVerificationTokenError,
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("quên mật khẩu", () => {
    it("email KHÔNG tồn tại và email CÓ tồn tại cho ra cùng một kết quả — không lộ ai đã đăng ký", async () => {
      // Route trả cùng một thông điệp dựa trên việc service không ném lỗi và
      // không trả gì khác nhau giữa hai trường hợp.
      const khongCo = createAuth(createDb());
      const coDeps = createDeps();
      coDeps.users.findByEmail.mockResolvedValue(PUBLIC_USER);
      const co = createAuth(createDb(), coDeps);

      const [a, b] = await Promise.all([
        khongCo.service.requestPasswordReset("khong-co@b.com"),
        co.service.requestPasswordReset("a@b.com"),
      ]);

      expect(a).toBeUndefined();
      expect(b).toBeUndefined();
      expect(khongCo.verification.issue).not.toHaveBeenCalled();
      expect(co.verification.issue).toHaveBeenCalledWith("u1", "PASSWORD_RESET");
      expect(mocks.sendPasswordResetEmail).toHaveBeenCalledOnce();
      expect(mocks.sendPasswordResetEmail).toHaveBeenCalledWith("a@b.com", "token-gui-di");
    });

    it("tra email qua `users.findByEmail` — nơi giữ luật chữ thường và bỏ qua tài khoản xoá mềm", async () => {
      const { service, users } = createAuth(createDb());

      await service.requestPasswordReset("A@B.com");

      expect(users.findByEmail).toHaveBeenCalledWith("A@B.com");
    });

    it("tài khoản chỉ có số điện thoại (không email) thì không cấp token", async () => {
      const deps = createDeps();
      deps.users.findByEmail.mockResolvedValue({ ...PUBLIC_USER, email: null });

      await createAuth(createDb(), deps).service.requestPasswordReset("a@b.com");

      expect(deps.verification.issue).not.toHaveBeenCalled();
    });
  });

  describe("đặt lại mật khẩu bằng token", () => {
    function setupReset() {
      const db = createDb({
        user: { update: vi.fn().mockResolvedValue({ id: "u1", email: "a@b.com" }) },
      });
      const deps = createDeps();
      deps.verification.consume.mockResolvedValue({ userId: "u1", destination: null });
      return { db, ...createAuth(db, deps) };
    }

    it("token sai/đã dùng thì ném lỗi, KHÔNG đổi mật khẩu, KHÔNG thu hồi phiên", async () => {
      const db = createDb();
      const { service, tokens } = createAuth(db);

      await expect(service.resetPassword("rac", "MoiMoi@123")).rejects.toBeInstanceOf(
        InvalidVerificationTokenError,
      );
      expect(db.user.update).not.toHaveBeenCalled();
      expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    });

    it("lưu HASH Argon2id của mật khẩu mới, cập nhật `passwordChangedAt`, gỡ khoá tạm", async () => {
      // `passwordChangedAt` là thứ làm mọi access token phát trước đó mất
      // hiệu lực (so với `iat`). Gỡ khoá vì người chứng minh được quyền sở
      // hữu email không nên tiếp tục bị khoá bởi kẻ đã dò mật khẩu.
      const { db, service } = setupReset();
      const before = Date.now();

      const userId = await service.resetPassword("tok", "MoiMoi@123");

      expect(userId).toBe("u1");
      const call = vi.mocked(db.user.update).mock.calls[0]![0];
      expect(call.where).toEqual({ id: "u1" });
      const data = call.data as {
        password: string;
        passwordChangedAt: Date;
        failedLoginAttempts: number;
        lockedUntil: null;
      };
      expect(data.password).not.toBe("MoiMoi@123");
      expect(data.password).toMatch(/^\$argon2id\$/);
      expect((await CryptoUtils.verifyPassword("MoiMoi@123", data.password)).valid).toBe(true);
      expect(data.passwordChangedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(data.failedLoginAttempts).toBe(0);
      expect(data.lockedUntil).toBeNull();
    });

    it("thu hồi TOÀN BỘ refresh token (không giữ phiên nào) và vô hiệu security stamp", async () => {
      // Kịch bản điển hình của luồng này là tài khoản đã bị chiếm — để phiên
      // của kẻ tấn công sống tiếp là đổi mật khẩu vô nghĩa.
      const { service, tokens, securityStamp, verification } = setupReset();

      await service.resetPassword("tok", "MoiMoi@123");

      expect(verification.consume).toHaveBeenCalledWith("tok", "PASSWORD_RESET");
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith("u1");
      expect(securityStamp.invalidate).toHaveBeenCalledWith("u1");
      expect(mocks.sendPasswordChangedEmail).toHaveBeenCalledWith("a@b.com");
    });

    it("gửi thư báo đổi mật khẩu hỏng thì việc đặt lại vẫn thành công", async () => {
      mocks.sendPasswordChangedEmail.mockRejectedValue(new Error("SMTP chết"));
      const { service } = setupReset();

      await expect(service.resetPassword("tok", "MoiMoi@123")).resolves.toBe("u1");
      expect(mocks.logger.error).toHaveBeenCalledWith(
        "Không gửi được email thông báo đổi mật khẩu",
        expect.any(Error),
        { userId: "u1" },
      );
    });

    it("tài khoản không có email thì không gửi thư báo", async () => {
      const { db, service } = setupReset();
      vi.mocked(db.user.update).mockResolvedValue({ id: "u1", email: null } as never);

      await service.resetPassword("tok", "MoiMoi@123");

      expect(mocks.sendPasswordChangedEmail).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("đổi mật khẩu khi đang đăng nhập", () => {
    function dbWithUser(user: unknown) {
      return createDb({ user: { findFirst: vi.fn().mockResolvedValue(user) } });
    }

    it("bắt nhập lại mật khẩu hiện tại — sai thì KHÔNG đổi mật khẩu nhưng TĂNG bộ đếm sai", async () => {
      // Ai ngồi vào máy đang mở sẵn phiên không được chiếm tài khoản vĩnh viễn. Và sai ở đây cũng tính
      // vào khoá tạm: trước đây không đếm, cầm được một phiên là dò mật khẩu thật không giới hạn.
      const db = dbWithUser({
        id: "u1",
        email: "a@b.com",
        password: CURRENT_HASH,
        lockedUntil: null,
      });
      const { service, tokens } = createAuth(db);

      await expect(
        service.changePassword("u1", WRONG_PASSWORD, "MoiMoi@123"),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
      expect(db.user.update).toHaveBeenCalledTimes(1);
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { failedLoginAttempts: { increment: 1 } } }),
      );
      expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    });

    it("tài khoản đang bị khoá thì không đổi được mật khẩu, kể cả nhập đúng", async () => {
      const db = dbWithUser({
        id: "u1",
        email: "a@b.com",
        password: CURRENT_HASH,
        lockedUntil: new Date(Date.now() + 60_000),
      });

      await expect(
        createAuth(db).service.changePassword("u1", PASSWORD, "MoiMoi@123"),
      ).rejects.toBeInstanceOf(AccountLockedError);
      expect(db.user.update).not.toHaveBeenCalled();
    });

    it("tài khoản chưa có mật khẩu / đã xoá mềm thì báo lỗi chung và vẫn đốt thời gian giả", async () => {
      const fakeCompare = vi.spyOn(CryptoUtils, "fakeCompare");
      const db = dbWithUser(null);

      await expect(
        createAuth(db).service.changePassword("u1", PASSWORD, "MoiMoi@123"),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
      expect(fakeCompare).toHaveBeenCalledWith(PASSWORD);
      expect(vi.mocked(db.user.findFirst).mock.calls[0]![0]!.where).toEqual({
        id: "u1",
        deletedAt: null,
      });
    });

    it("đúng thì lưu hash mới + `passwordChangedAt`, thu hồi mọi phiên TRỪ phiên đang thao tác", async () => {
      // Đá người dùng ra khỏi chính thiết bị vừa đổi mật khẩu trông y như lỗi.
      const db = dbWithUser({ id: "u1", email: "a@b.com", password: CURRENT_HASH });
      const { service, tokens, securityStamp } = createAuth(db);

      await service.changePassword("u1", PASSWORD, "MoiMoi@123", "fam-hien-tai");

      const data = vi.mocked(db.user.update).mock.calls[0]![0].data as {
        password: string;
        passwordChangedAt: Date;
      };
      expect(data.password).toMatch(/^\$argon2id\$/);
      expect(data.passwordChangedAt).toBeInstanceOf(Date);
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith("u1", {
        exceptFamilyId: "fam-hien-tai",
      });
      expect(securityStamp.invalidate).toHaveBeenCalledWith("u1");
      expect(mocks.sendPasswordChangedEmail).toHaveBeenCalledWith("a@b.com");
    });

    it("gửi thư báo hỏng thì đổi mật khẩu vẫn thành công; không email thì không gửi", async () => {
      mocks.sendPasswordChangedEmail.mockRejectedValue(new Error("SMTP chết"));
      const coEmail = createAuth(
        dbWithUser({ id: "u1", email: "a@b.com", password: CURRENT_HASH }),
      );
      await expect(
        coEmail.service.changePassword("u1", PASSWORD, "MoiMoi@123"),
      ).resolves.toBeUndefined();
      expect(mocks.logger.error).toHaveBeenCalledOnce();

      mocks.sendPasswordChangedEmail.mockClear();
      const khongEmail = createAuth(dbWithUser({ id: "u1", email: null, password: CURRENT_HASH }));
      await khongEmail.service.changePassword("u1", PASSWORD, "MoiMoi@123");
      expect(mocks.sendPasswordChangedEmail).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("đổi địa chỉ email", () => {
    function dbForChange(user: unknown, taken: unknown = null) {
      return createDb({
        user: { findFirst: vi.fn().mockResolvedValueOnce(user).mockResolvedValueOnce(taken) },
      });
    }

    it("bắt nhập lại mật khẩu — sai thì không cấp token, không gửi thư", async () => {
      const db = dbForChange({ id: "u1", email: "cu@b.com", password: CURRENT_HASH });
      const { service, verification } = createAuth(db);

      await expect(
        service.requestEmailChange("u1", "moi@b.com", WRONG_PASSWORD),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
      expect(verification.issue).not.toHaveBeenCalled();
      expect(mocks.sendEmailChangeVerificationEmail).not.toHaveBeenCalled();
    });

    it("tài khoản chưa có mật khẩu thì báo lỗi chung và đốt thời gian giả", async () => {
      const fakeCompare = vi.spyOn(CryptoUtils, "fakeCompare");
      const db = dbForChange({ id: "u1", email: "cu@b.com", password: null });

      await expect(
        createAuth(db).service.requestEmailChange("u1", "moi@b.com", PASSWORD),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
      expect(fakeCompare).toHaveBeenCalledOnce();
    });

    it("email mới đã có người dùng thì báo trùng — kiểm loại trừ chính mình và tài khoản xoá mềm", async () => {
      const db = dbForChange({ id: "u1", email: "cu@b.com", password: CURRENT_HASH }, { id: "u2" });

      await expect(
        createAuth(db).service.requestEmailChange("u1", " Moi@B.com ", PASSWORD),
      ).rejects.toBeInstanceOf(DuplicateFieldError);
      expect(vi.mocked(db.user.findFirst).mock.calls[1]![0]!.where).toEqual({
        email: "moi@b.com",
        deletedAt: null,
        NOT: { id: "u1" },
      });
    });

    it("KHÔNG ghi thẳng vào user.email: cấp token EMAIL_CHANGE, gửi link tới địa chỉ MỚI, báo động tới địa chỉ CŨ", async () => {
      // Ghi thẳng là đường chiếm tài khoản kinh điển: đổi email sang của mình
      // rồi "quên mật khẩu". Thư tới địa chỉ cũ là tín hiệu duy nhất chủ
      // thật nhận được.
      const db = dbForChange({ id: "u1", email: "cu@b.com", password: CURRENT_HASH });
      const { service, verification } = createAuth(db);

      await service.requestEmailChange("u1", " Moi@B.com ", PASSWORD);

      expect(db.user.update).not.toHaveBeenCalled();
      expect(verification.issue).toHaveBeenCalledWith("u1", "EMAIL_CHANGE", "moi@b.com");
      expect(mocks.sendEmailChangeVerificationEmail).toHaveBeenCalledWith(
        "moi@b.com",
        "token-gui-di",
      );
      expect(mocks.sendEmailChangeNoticeEmail).toHaveBeenCalledWith("cu@b.com", "moi@b.com");
    });

    it("thư báo tới địa chỉ cũ gửi hỏng thì không chặn luồng nhưng PHẢI ghi log", async () => {
      mocks.sendEmailChangeNoticeEmail.mockRejectedValue(new Error("SMTP chết"));
      const db = dbForChange({ id: "u1", email: "cu@b.com", password: CURRENT_HASH });

      await expect(
        createAuth(db).service.requestEmailChange("u1", "moi@b.com", PASSWORD),
      ).resolves.toBeUndefined();
      expect(mocks.logger.error).toHaveBeenCalledWith(
        "Không gửi được thư báo đổi email tới địa chỉ cũ",
        expect.any(Error),
        { userId: "u1" },
      );
    });

    it("tài khoản chưa từng có email thì không có địa chỉ cũ để báo", async () => {
      const db = dbForChange({ id: "u1", email: null, password: CURRENT_HASH });

      await createAuth(db).service.requestEmailChange("u1", "moi@b.com", PASSWORD);

      expect(mocks.sendEmailChangeVerificationEmail).toHaveBeenCalledOnce();
      expect(mocks.sendEmailChangeNoticeEmail).not.toHaveBeenCalled();
    });

    describe("confirmEmailChange", () => {
      function depsWithToken(consumed: unknown) {
        const deps = createDeps();
        deps.verification.consume.mockResolvedValue(consumed);
        return deps;
      }

      it("token sai, hoặc token không mang địa chỉ đích, thì ném lỗi và không ghi gì", async () => {
        const db = createDb();

        await expect(createAuth(db).service.confirmEmailChange("rac")).rejects.toBeInstanceOf(
          InvalidVerificationTokenError,
        );
        await expect(
          createAuth(
            db,
            depsWithToken({ userId: "u1", destination: null }),
          ).service.confirmEmailChange("tok"),
        ).rejects.toBeInstanceOf(InvalidVerificationTokenError);
        expect(db.user.update).not.toHaveBeenCalled();
      });

      it("ghi địa chỉ lấy từ TOKEN, đánh dấu đã xác thực, xoá pendingEmail và thu hồi mọi refresh token", async () => {
        // Email là danh tính khôi phục tài khoản: đổi xong mà để phiên cũ
        // sống thì kẻ đã chiếm phiên vẫn ở nguyên đó.
        const db = createDb();
        const deps = depsWithToken({ userId: "u1", destination: "moi@b.com" });

        const user = await createAuth(db, deps).service.confirmEmailChange("tok");

        expect(deps.verification.consume).toHaveBeenCalledWith("tok", "EMAIL_CHANGE");
        expect(db.user.update).toHaveBeenCalledWith({
          where: { id: "u1" },
          data: {
            email: "moi@b.com",
            emailVerifiedAt: expect.any(Date),
            pendingEmail: null,
            // Mốc thu hồi phiên — thiếu thì access token của kẻ chiếm phiên sống thêm ~15 phút.
            passwordChangedAt: expect.any(Date),
          },
        });
        expect(deps.tokens.revokeAllForUser).toHaveBeenCalledWith("u1");
        expect(deps.securityStamp.invalidate).toHaveBeenCalledWith("u1");
        expect(user).toEqual(PUBLIC_USER);
      });

      it("có người chiếm địa chỉ trong lúc chờ (P2002) thì báo trùng, không thu hồi phiên", async () => {
        const db = createDb({
          user: {
            update: vi.fn().mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" })),
          },
        });
        const deps = depsWithToken({ userId: "u1", destination: "moi@b.com" });

        await expect(createAuth(db, deps).service.confirmEmailChange("tok")).rejects.toBeInstanceOf(
          DuplicateFieldError,
        );
        expect(deps.tokens.revokeAllForUser).not.toHaveBeenCalled();
      });

      it("lỗi database khác thì ném nguyên lỗi, không đổi thành lỗi trùng", async () => {
        const boom = new Error("mất kết nối");
        const db = createDb({ user: { update: vi.fn().mockRejectedValue(boom) } });

        await expect(
          createAuth(
            db,
            depsWithToken({ userId: "u1", destination: "moi@b.com" }),
          ).service.confirmEmailChange("tok"),
        ).rejects.toBe(boom);
      });

      it("tài khoản không còn sau khi đổi thì báo token không hợp lệ", async () => {
        const deps = depsWithToken({ userId: "u1", destination: "moi@b.com" });
        deps.users.findById.mockResolvedValue(null);

        await expect(
          createAuth(createDb(), deps).service.confirmEmailChange("tok"),
        ).rejects.toBeInstanceOf(InvalidVerificationTokenError);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("xác thực số điện thoại", () => {
    describe("requestPhoneVerification", () => {
      it("tính năng TẮT thì từ chối trước khi đụng tới database hay SMS", async () => {
        mocks.isPhoneVerificationEnabled.mockReturnValue(false);
        const db = createDb();

        await expect(
          createAuth(db).service.requestPhoneVerification("u1", "0912345678"),
        ).rejects.toBeInstanceOf(PhoneVerificationDisabledError);
        expect(db.user.findFirst).not.toHaveBeenCalled();
        expect(mocks.sendPhoneOtpSms).not.toHaveBeenCalled();
      });

      it("chuẩn hoá +84 về 0… TRƯỚC khi kiểm trùng, đếm giới hạn và gửi", async () => {
        // Không chuẩn hoá thì đổi cách viết là lách được trần OTP theo ngày.
        const db = createDb();
        const { service, verification } = createAuth(db);

        await service.requestPhoneVerification("u1", "+84 912.345-678");

        expect(vi.mocked(db.user.findFirst).mock.calls[0]![0]!.where).toEqual({
          phone: "0912345678",
          deletedAt: null,
          NOT: { id: "u1" },
        });
        expect(mocks.rateLimit).toHaveBeenNthCalledWith(1, "otp:cooldown:0912345678", {
          limit: 1,
          windowSeconds: env.PHONE_OTP_RESEND_COOLDOWN_SECONDS,
        });
        expect(mocks.rateLimit).toHaveBeenNthCalledWith(2, "otp:daily:0912345678", {
          limit: env.PHONE_OTP_MAX_PER_DAY,
          windowSeconds: 86_400,
        });
        expect(verification.issue).toHaveBeenCalledWith("u1", "PHONE_OTP", "0912345678");
        expect(mocks.sendPhoneOtpSms).toHaveBeenCalledWith("0912345678", "token-gui-di");
      });

      it("số đã thuộc tài khoản khác thì báo trùng và KHÔNG tiêu tin nhắn", async () => {
        const db = createDb({ user: { findFirst: vi.fn().mockResolvedValue({ id: "u2" }) } });

        await expect(
          createAuth(db).service.requestPhoneVerification("u1", "0912345678"),
        ).rejects.toBeInstanceOf(DuplicateFieldError);
        expect(mocks.rateLimit).not.toHaveBeenCalled();
        expect(mocks.sendPhoneOtpSms).not.toHaveBeenCalled();
      });

      it("đang trong thời gian chờ giữa hai lần gửi thì chặn, không gửi", async () => {
        mocks.rateLimit.mockResolvedValueOnce({
          success: false,
          remaining: 0,
          limit: 1,
          retryAfterSeconds: 42,
        });
        const { service, verification } = createAuth(createDb());

        const error = await catchError(service.requestPhoneVerification("u1", "0912345678"));

        expect(error).toBeInstanceOf(PhoneOtpThrottledError);
        expect(error.message).toContain("42");
        expect(verification.issue).not.toHaveBeenCalled();
        expect(mocks.sendPhoneOtpSms).not.toHaveBeenCalled();
      });

      it("chạm trần theo ngày thì chặn, không gửi", async () => {
        mocks.rateLimit
          .mockResolvedValueOnce({ success: true, remaining: 0, limit: 1, retryAfterSeconds: 0 })
          .mockResolvedValueOnce({
            success: false,
            remaining: 0,
            limit: 5,
            retryAfterSeconds: 7200,
          });

        await expect(
          createAuth(createDb()).service.requestPhoneVerification("u1", "0912345678"),
        ).rejects.toBeInstanceOf(PhoneOtpThrottledError);
        expect(mocks.sendPhoneOtpSms).not.toHaveBeenCalled();
      });
    });

    describe("confirmPhoneVerification", () => {
      function setup(pending: unknown, otpOk: boolean, update?: ReturnType<typeof vi.fn>) {
        const db = createDb({
          verificationToken: { findFirst: vi.fn().mockResolvedValue(pending) },
          ...(update ? { user: { update } } : {}),
        });
        const deps = createDeps();
        deps.verification.consumeOtp.mockResolvedValue(otpOk);
        return { db, ...createAuth(db, deps) };
      }

      it("tính năng TẮT thì từ chối", async () => {
        mocks.isPhoneVerificationEnabled.mockReturnValue(false);
        const { service } = setup({ destination: "0912345678" }, true);

        await expect(service.confirmPhoneVerification("u1", "123456")).rejects.toBeInstanceOf(
          PhoneVerificationDisabledError,
        );
      });

      it("không có mã nào đang chờ thì báo mã không hợp lệ", async () => {
        const { service, verification } = setup(null, true);

        await expect(service.confirmPhoneVerification("u1", "123456")).rejects.toBeInstanceOf(
          InvalidVerificationTokenError,
        );
        expect(verification.consumeOtp).not.toHaveBeenCalled();
      });

      it("mã sai thì KHÔNG gắn số vào tài khoản", async () => {
        const { db, service } = setup({ destination: "0912345678" }, false);

        await expect(service.confirmPhoneVerification("u1", "000000")).rejects.toBeInstanceOf(
          InvalidVerificationTokenError,
        );
        expect(db.user.update).not.toHaveBeenCalled();
      });

      it("mã đúng thì gắn số lấy từ BẢN GHI TOKEN — client không có cách nào chọn số khác", async () => {
        // Nhận số từ client là gửi mã của số A kèm số B rồi gắn được số chưa
        // hề xác thực.
        const { db, service, verification } = setup({ destination: "0912345678" }, true);

        const user = await service.confirmPhoneVerification("u1", "123456");

        expect(vi.mocked(db.verificationToken.findFirst).mock.calls[0]![0]!.where).toEqual({
          userId: "u1",
          type: "PHONE_OTP",
          usedAt: null,
        });
        expect(verification.consumeOtp).toHaveBeenCalledWith("u1", "PHONE_OTP", "123456");
        expect(db.user.update).toHaveBeenCalledWith({
          where: { id: "u1" },
          data: { phone: "0912345678", phoneVerifiedAt: expect.any(Date) },
        });
        expect(user).toEqual(PUBLIC_USER);
      });

      it("số bị người khác gắn trong lúc chờ (P2002) thì báo trùng", async () => {
        const { service } = setup(
          { destination: "0912345678" },
          true,
          vi.fn().mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" })),
        );

        await expect(service.confirmPhoneVerification("u1", "123456")).rejects.toBeInstanceOf(
          DuplicateFieldError,
        );
      });

      it("lỗi database khác thì ném nguyên lỗi", async () => {
        const boom = new Error("mất kết nối");
        const { service } = setup(
          { destination: "0912345678" },
          true,
          vi.fn().mockRejectedValue(boom),
        );

        await expect(service.confirmPhoneVerification("u1", "123456")).rejects.toBe(boom);
      });

      it("tài khoản không còn sau khi gắn số thì báo mã không hợp lệ", async () => {
        const { service, users } = setup({ destination: "0912345678" }, true);
        users.findById.mockResolvedValue(null);

        await expect(service.confirmPhoneVerification("u1", "123456")).rejects.toBeInstanceOf(
          InvalidVerificationTokenError,
        );
      });
    });
  });
});
