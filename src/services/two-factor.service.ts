import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { CryptoUtils } from "@/lib/crypto";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "@/lib/encryption";
import { createTotpSecret, verifyTotp } from "@/lib/totp";
import { generateRecoveryCode, hashScopedToken, normalizeRecoveryCode } from "@/lib/opaque-token";
import {
  InvalidCredentialsError,
  InvalidTwoFactorCodeError,
  TwoFactorAlreadyEnabledError,
  TwoFactorNotEnabledError,
  UserNotFoundError,
} from "@/lib/errors";

/**
 * Xác thực hai lớp bằng TOTP (Google Authenticator, Authy, 1Password…).
 *
 * ---
 * LUỒNG BẬT 2FA — BA BƯỚC, KHÔNG PHẢI MỘT
 *
 *   1. `beginSetup()`  → sinh bí mật, trả URI để dựng QR. **CHƯA bật.**
 *   2. Người dùng quét QR bằng app xác thực.
 *   3. `confirmSetup(code)` → mã đúng thì mới thật sự bật, và trả về mã khôi phục.
 *
 * Bước 3 không phải thủ tục thừa: nó chứng minh app xác thực ĐÃ lưu đúng bí
 * mật. Bật ngay từ bước 1 thì người quét QR hỏng sẽ bị khoá vĩnh viễn khỏi tài
 * khoản của chính mình — và đó là kịch bản thường gặp, không phải hiếm.
 *
 * ---
 * MÃ KHÔI PHỤC
 *
 * Cấp một lần duy nhất, hiển thị đúng một lần, lưu dưới dạng băm. Không có
 * chúng thì "mất điện thoại = mất tài khoản", và người dùng sẽ không bật 2FA.
 *
 * Băm KÈM `userId` (`hashScopedToken`) vì mã khôi phục ngắn hơn token trong
 * email — 50 bit là đủ để không dò được, nhưng chưa đủ để coi va chạm là không
 * thể.
 *
 * ---
 * KHÔNG CÓ "THIẾT BỊ TIN CẬY"
 *
 * Cố ý bỏ tính năng "đừng hỏi mã trên máy này trong 30 ngày". Nó là một cơ chế
 * BỎ QUA 2FA: thêm một credential dài hạn nữa để đánh cắp, và làm rỗng phần
 * lớn giá trị của lớp bảo vệ vừa dựng. Dự án nào cần thì thêm sau, có cân nhắc
 * — bộ khung không bật sẵn một đường vòng.
 */
export type TwoFactorSetup = {
  /** Bí mật base32 — hiển thị cho người dùng nhập tay khi không quét được QR. */
  secret: string;
  /** URI `otpauth://` để dựng mã QR. ⚠️ Chứa bí mật, đừng ghi vào log. */
  uri: string;
};

export type TwoFactorStatus = {
  enabled: boolean;
  enabledAt: Date | null;
  /** Số mã khôi phục CHƯA dùng. Dưới 3 thì giao diện nên nhắc cấp lại. */
  remainingRecoveryCodes: number;
};

/** Số mã khôi phục cấp mỗi lần. 10 là mức chuẩn của hầu hết dịch vụ lớn. */
const RECOVERY_CODE_COUNT = 10;

export class TwoFactorService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** `true` khi hệ thống đủ điều kiện chạy 2FA (đã có khoá mã hoá). */
  isAvailable(): boolean {
    return isEncryptionConfigured();
  }

  async status(userId: string): Promise<TwoFactorStatus> {
    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        twoFactorEnabledAt: true,
        _count: { select: { recoveryCodes: { where: { usedAt: null } } } },
      },
    });

    if (!user) throw new UserNotFoundError(userId);

    return {
      enabled: user.twoFactorEnabledAt !== null,
      enabledAt: user.twoFactorEnabledAt,
      remainingRecoveryCodes: user._count.recoveryCodes,
    };
  }

  /**
   * Bước 1: sinh bí mật và trả về URI để quét.
   *
   * Ghi bí mật vào database ngay (đã mã hoá) nhưng KHÔNG đặt
   * `twoFactorEnabledAt` — trạng thái "đang cài dở". Phải lưu vì bước xác nhận
   * là một request khác, và giữ nó trong RAM giữa hai request thì hỏng ngay
   * khi chạy từ hai instance.
   *
   * Gọi lại nhiều lần thì bí mật cũ bị GHI ĐÈ: người dùng quét nhầm rồi làm
   * lại là chuyện bình thường, và để lại bí mật mồ côi chỉ tạo nhầm lẫn.
   */
  async beginSetup(userId: string): Promise<TwoFactorSetup> {
    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { email: true, username: true, twoFactorEnabledAt: true },
    });

    if (!user) throw new UserNotFoundError(userId);
    if (user.twoFactorEnabledAt) throw new TwoFactorAlreadyEnabledError();

    const label = user.email ?? user.username ?? userId;
    const setup = createTotpSecret(env.APP_NAME, label);

    await this.db.user.update({
      where: { id: userId },
      data: { twoFactorSecret: encryptSecret(setup.secret) },
    });

    return setup;
  }

  /**
   * Bước 3: xác nhận và bật thật.
   *
   * Trả về danh sách mã khôi phục — đây là LẦN DUY NHẤT chúng tồn tại ở dạng
   * đọc được. Nơi gọi phải hiển thị ngay và nhắc người dùng lưu lại.
   */
  async confirmSetup(userId: string, code: string): Promise<string[]> {
    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { twoFactorSecret: true, twoFactorEnabledAt: true },
    });

    if (!user) throw new UserNotFoundError(userId);
    if (user.twoFactorEnabledAt) throw new TwoFactorAlreadyEnabledError();
    if (!user.twoFactorSecret) throw new TwoFactorNotEnabledError();

    if (verifyTotp(this.decrypt(user.twoFactorSecret), code) === null) {
      throw new InvalidTwoFactorCodeError();
    }

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());

    await this.db.$transaction([
      this.db.user.update({
        where: { id: userId },
        data: { twoFactorEnabledAt: new Date() },
      }),
      // Xoá mã cũ trước: gọi lại luồng cài đặt không được để lại mã của lần
      // trước còn dùng được.
      this.db.recoveryCode.deleteMany({ where: { userId } }),
      this.db.recoveryCode.createMany({
        data: codes.map((code) => ({
          userId,
          codeHash: hashScopedToken(userId, normalizeRecoveryCode(code)),
        })),
      }),
    ]);

    logger.info("Đã bật xác thực hai lớp", { userId });
    return codes;
  }

  /**
   * Kiểm tra mã lúc đăng nhập. Chấp nhận CẢ mã TOTP lẫn mã khôi phục.
   *
   * Thử TOTP trước vì đó là đường đi thường ngày; mã khôi phục là ngoại lệ.
   *
   * Mã khôi phục được đánh dấu đã dùng bằng `updateMany` có điều kiện
   * `usedAt: null` — cùng lý do với `VerificationService.consume`: hai request
   * song song với cùng một mã thì chỉ một cái được đi tiếp.
   */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { twoFactorSecret: true, twoFactorEnabledAt: true },
    });

    if (!user?.twoFactorEnabledAt || !user.twoFactorSecret) return false;

    if (verifyTotp(this.decrypt(user.twoFactorSecret), code) !== null) return true;

    return this.consumeRecoveryCode(userId, code);
  }

  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const normalized = normalizeRecoveryCode(code);

    // Định dạng mã khôi phục là 10 ký tự; mã TOTP là 6 chữ số. Chặn sớm để một
    // mã TOTP sai không phải đi qua một truy vấn database vô ích.
    if (normalized.length !== 10) return false;

    const claimed = await this.db.recoveryCode.updateMany({
      where: { userId, codeHash: hashScopedToken(userId, normalized), usedAt: null },
      data: { usedAt: new Date() },
    });

    if (claimed.count > 0) {
      // Phải nhìn thấy được: dùng mã khôi phục nghĩa là người dùng mất quyền
      // truy cập app xác thực — hoặc ai đó đang dùng mã lấy trộm được.
      logger.warn("Đăng nhập bằng MÃ KHÔI PHỤC 2FA", { userId });
      return true;
    }

    return false;
  }

  /**
   * Tắt 2FA. Bắt nhập lại MẬT KHẨU và một mã hợp lệ.
   *
   * Hai lớp có chủ đích: ai ngồi vào máy đang mở sẵn phiên không được phép gỡ
   * lớp bảo vệ chỉ bằng một cú bấm. Tài khoản chưa có mật khẩu (đăng nhập qua
   * OAuth) thì bỏ qua vế mật khẩu — không có gì để kiểm.
   */
  async disable(userId: string, password: string | null, code: string): Promise<void> {
    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { password: true, twoFactorEnabledAt: true },
    });

    if (!user) throw new UserNotFoundError(userId);
    if (!user.twoFactorEnabledAt) throw new TwoFactorNotEnabledError();

    if (user.password) {
      if (!password) throw new InvalidCredentialsError();

      const check = await CryptoUtils.verifyPassword(password, user.password);
      if (!check.valid) throw new InvalidCredentialsError();
    }

    if (!(await this.verifyCode(userId, code))) throw new InvalidTwoFactorCodeError();

    await this.db.$transaction([
      this.db.user.update({
        where: { id: userId },
        data: { twoFactorSecret: null, twoFactorEnabledAt: null },
      }),
      this.db.recoveryCode.deleteMany({ where: { userId } }),
    ]);

    logger.warn("Đã TẮT xác thực hai lớp", { userId });
  }

  /**
   * Cấp lại bộ mã khôi phục. Mã cũ mất hiệu lực ngay.
   *
   * Dùng khi người dùng đã tiêu gần hết mã, hoặc nghi tờ giấy chép mã bị lộ.
   */
  async regenerateRecoveryCodes(userId: string, code: string): Promise<string[]> {
    const status = await this.status(userId);
    if (!status.enabled) throw new TwoFactorNotEnabledError();

    if (!(await this.verifyCode(userId, code))) throw new InvalidTwoFactorCodeError();

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());

    await this.db.$transaction([
      this.db.recoveryCode.deleteMany({ where: { userId } }),
      this.db.recoveryCode.createMany({
        data: codes.map((item) => ({
          userId,
          codeHash: hashScopedToken(userId, normalizeRecoveryCode(item)),
        })),
      }),
    ]);

    logger.info("Đã cấp lại mã khôi phục 2FA", { userId });
    return codes;
  }

  /**
   * Giải mã bí mật. Lỗi giải mã KHÔNG được lộ ra ngoài dưới dạng 500.
   *
   * Nó xảy ra khi `ENCRYPTION_KEY` bị đổi sau khi đã có dữ liệu — một sự cố
   * vận hành, không phải lỗi của người đang đăng nhập. Họ nhận "mã không đúng"
   * và liên hệ hỗ trợ; log giữ nguyên nguyên nhân thật.
   */
  private decrypt(encrypted: string): string {
    try {
      return decryptSecret(encrypted);
    } catch (error) {
      logger.error(
        "Không giải mã được khoá 2FA — ENCRYPTION_KEY có thể đã bị đổi sau khi có dữ liệu",
        error,
      );
      throw new InvalidTwoFactorCodeError();
    }
  }
}

/**
 * Instance dùng chung cho toàn ứng dụng.
 *
 * Constructor nhận `prisma` làm THAM SỐ MẶC ĐỊNH chứ không import cứng: chỗ
 * gọi không phải đổi gì, mà test vẫn tiêm được database giả thay vì phải mock
 * cả module `@/lib/prisma`.
 */
export const twoFactorService = new TwoFactorService();
