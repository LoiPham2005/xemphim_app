import type { PrismaClient, VerificationTokenType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import {
  generateNumericOtp,
  generateOpaqueToken,
  hashOpaqueToken,
  hashScopedToken,
} from "@/lib/opaque-token";
import { TooManyVerificationAttemptsError } from "@/lib/errors";

/**
 * Vòng đời token dùng MỘT LẦN gửi qua email/SMS.
 *
 * Bốn tính chất, theo thứ tự quan trọng:
 *
 * 1. Database chỉ lưu bản băm. Rò database không đồng nghĩa với chiếm được tài
 *    khoản.
 * 2. Dùng một lần THẬT SỰ — đánh dấu bằng thao tác nguyên tử, nên hai request
 *    đồng thời với cùng một token chỉ một cái thành công.
 * 3. Cấp token mới thì token cũ CÙNG LOẠI bị xoá. Người dùng bấm "gửi lại" ba
 *    lần thì chỉ mã cuối cùng còn hiệu lực.
 * 4. Hạn ngắn, khác nhau theo loại (xem `ttlFor`).
 *
 * ---
 * HAI KIỂU BĂM — ĐÂY LÀ PHẦN QUAN TRỌNG NHẤT CỦA FILE NÀY
 *
 * • **Token trong LINK** (`EMAIL_VERIFICATION`, `EMAIL_CHANGE`,
 *   `PASSWORD_RESET`): 256 bit ngẫu nhiên, băm TRẦN. Bắt buộc phải vậy vì
 *   người dùng bấm vào link và chỉ gửi lại mỗi token — không có `userId` nào
 *   để mà kèm vào.
 *
 * • **OTP** (`PHONE_OTP`): chỉ 6 chữ số, băm KÈM `userId`. Băm trần thì
 *   `SHA-256("123456")` là một hằng số, và tra cứu bằng nó sẽ trả về bản ghi
 *   của NGƯỜI KHÁC — tức là A nhập đúng mã của mình rồi đăng nhập vào tài
 *   khoản B. Xem `hashScopedToken`.
 *
 * Hệ quả: OTP phải dùng `consumeOtp(userId, …)`, không dùng `consume(token, …)`.
 */

export type IssuedVerificationToken = {
  /** Chuỗi gốc — chỉ tồn tại trong lần gọi này, không lưu ở đâu cả. */
  token: string;
  expiresAt: Date;
};

/** Loại token được gửi qua link, băm trần và tra cứu được bằng chính token. */
const LINK_TYPES = ["EMAIL_VERIFICATION", "EMAIL_CHANGE", "PASSWORD_RESET"] as const;

function isLinkType(type: VerificationTokenType): boolean {
  return (LINK_TYPES as readonly string[]).includes(type);
}

function ttlMsFor(type: VerificationTokenType): number {
  switch (type) {
    case "EMAIL_VERIFICATION":
      return env.EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000;
    // Cùng hạn với xác thực email lần đầu: cùng là "chứng minh bạn đọc được
    // hộp thư này", cùng mức thiệt hại nếu link bị lộ.
    case "EMAIL_CHANGE":
      return env.EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000;
    case "PASSWORD_RESET":
      return env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000;
    case "PHONE_OTP":
      return env.PHONE_OTP_TTL_MINUTES * 60 * 1000;
  }
}

export class VerificationService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Cấp token mới, đồng thời huỷ mọi token cũ cùng loại của user.
   *
   * Xoá hẳn thay vì đánh dấu: chúng chưa từng được dùng nên đánh dấu `usedAt`
   * là ghi sai sự thật, mà giữ lại cũng không phục vụ mục đích kiểm toán nào.
   *
   * Gói trong transaction để không có khoảnh khắc nào mà token cũ đã bị xoá còn
   * token mới chưa kịp ghi.
   *
   * @param destination Nơi mã được gửi tới. Với `EMAIL_CHANGE` đây là địa chỉ
   * MỚI — và đây là chỗ DUY NHẤT lưu nó cho tới khi người dùng xác nhận.
   */
  async issue(
    userId: string,
    type: VerificationTokenType,
    destination?: string | null,
  ): Promise<IssuedVerificationToken> {
    // OTP qua SMS phải gõ tay nên chỉ 6 chữ số; token trong link thì dài và
    // ngẫu nhiên hoàn toàn. Entropy thấp của OTP được bù bằng hạn rất ngắn và
    // bộ đếm lần thử — xem `consumeOtp`.
    const token = type === "PHONE_OTP" ? generateNumericOtp() : generateOpaqueToken();
    const expiresAt = new Date(Date.now() + ttlMsFor(type));

    await this.db.$transaction([
      this.db.verificationToken.deleteMany({ where: { userId, type, usedAt: null } }),
      this.db.verificationToken.create({
        data: {
          tokenHash: this.hashFor(userId, type, token),
          type,
          userId,
          destination: destination ?? null,
          expiresAt,
        },
      }),
    ]);

    return { token, expiresAt };
  }

  private hashFor(userId: string, type: VerificationTokenType, token: string): string {
    return isLinkType(type) ? hashOpaqueToken(token) : hashScopedToken(`${userId}:${type}`, token);
  }

  /**
   * Đổi token trong LINK lấy bản ghi, và đánh dấu đã dùng.
   *
   * Trả `null` cho MỌI lý do thất bại — không tồn tại, sai loại, đã dùng, hết
   * hạn. Nơi gọi không cần phân biệt, và cũng KHÔNG NÊN nói cho người dùng biết
   * lý do cụ thể: "token này đã được dùng" xác nhận rằng token đó từng hợp lệ.
   *
   * Phép đánh dấu dùng `updateMany` với điều kiện `usedAt: null` rồi kiểm số
   * dòng bị ảnh hưởng. Đây là điểm mấu chốt: nếu đọc trước rồi ghi sau, hai
   * request song song đều thấy `usedAt` null và cùng đi tiếp — token dùng được
   * hai lần. Ràng buộc nằm trong chính câu lệnh ghi thì database phân xử.
   */
  async consume(
    token: string,
    type: VerificationTokenType,
  ): Promise<{ userId: string; destination: string | null } | null> {
    if (!isLinkType(type)) {
      // Chốt chặn lập trình, không phải lỗi người dùng: gọi nhầm hàm cho OTP sẽ
      // tra bằng hash trần và có thể khớp bản ghi của người khác.
      throw new Error(`Loại "${type}" phải dùng consumeOtp(), không dùng consume()`);
    }

    const record = await this.db.verificationToken.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
    });

    if (!record) return null;
    if (record.type !== type) return null;
    if (record.usedAt) return null;
    if (record.expiresAt <= new Date()) return null;

    const claimed = await this.db.verificationToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // 0 dòng nghĩa là một request khác vừa giành được token trước.
    if (claimed.count !== 1) return null;

    return { userId: record.userId, destination: record.destination };
  }

  /**
   * Đổi OTP lấy quyền đi tiếp. Phải BIẾT TRƯỚC `userId` — xem ghi chú đầu class.
   *
   * ---
   * VÌ SAO ĐẾM SỐ LẦN SAI TRÊN CHÍNH BẢN GHI
   *
   * OTP chỉ có 10^6 khả năng. Rate limit theo IP không cản được kẻ xoay vòng
   * IP — mà thuê một dải IP dân cư rẻ hơn nhiều so với giá trị một tài khoản.
   * Đếm trên bản ghi thì mọi IP cùng nhắm vào một mã đều dồn vào một bộ đếm.
   *
   * Chạm ngưỡng thì HUỶ mã (đánh dấu đã dùng), không chỉ từ chối lần đó: để mã
   * còn sống là kẻ tấn công chỉ cần đợi bộ đếm khác reset rồi tiếp tục.
   *
   * @throws {TooManyVerificationAttemptsError} khi vượt ngưỡng.
   */
  async consumeOtp(userId: string, type: VerificationTokenType, code: string): Promise<boolean> {
    const record = await this.db.verificationToken.findFirst({
      where: { userId, type, usedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (!record) return false;

    if (record.expiresAt <= new Date()) return false;

    if (record.attempts >= env.VERIFICATION_MAX_ATTEMPTS) {
      await this.db.verificationToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      throw new TooManyVerificationAttemptsError();
    }

    if (record.tokenHash !== hashScopedToken(`${userId}:${type}`, code)) {
      // Tăng bộ đếm bằng `increment` chứ không đọc-rồi-ghi: nhiều request song
      // song mà đọc-rồi-ghi thì tất cả cùng thấy cùng một giá trị cũ, và bộ đếm
      // chỉ nhích lên 1 sau cả loạt.
      const updated = await this.db.verificationToken.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });

      if (updated.attempts >= env.VERIFICATION_MAX_ATTEMPTS) {
        await this.db.verificationToken.updateMany({
          where: { id: record.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        throw new TooManyVerificationAttemptsError();
      }

      return false;
    }

    const claimed = await this.db.verificationToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    return claimed.count === 1;
  }

  /**
   * Dọn token đã hết hạn hoặc đã dùng.
   *
   * Bảng này CHỈ TĂNG: mỗi lần bấm "quên mật khẩu" là thêm một dòng, kể cả khi
   * người dùng không bao giờ mở email.
   */
  async purgeExpired(): Promise<number> {
    const result = await this.db.verificationToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }] },
    });
    return result.count;
  }
}

/**
 * Instance dùng chung cho toàn ứng dụng.
 *
 * Constructor nhận `prisma` làm THAM SỐ MẶC ĐỊNH chứ không import cứng: chỗ
 * gọi không phải đổi gì, mà test vẫn tiêm được database giả thay vì phải mock
 * cả module `@/lib/prisma`.
 */
export const verificationService = new VerificationService();
