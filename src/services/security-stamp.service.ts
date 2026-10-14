import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { cacheDel, cacheGet, cacheSet } from "@/lib/cache";

/**
 * Thu hồi TỨC THÌ mọi access token cũ khi mật khẩu đổi.
 *
 * ---
 * BÀI TOÁN
 *
 * JWT đã ký thì không thu hồi được — đó là bản chất của nó, và là lý do access
 * token chỉ sống 15 phút. Nhưng 15 phút vẫn là 15 phút mà kẻ đã chiếm tài
 * khoản còn thao tác được **sau khi** chủ thật đã đổi mật khẩu. Đúng lúc mà
 * việc chặn phải có hiệu lực ngay.
 *
 * Refresh token thì thu hồi được (nằm trong database) — nhưng nó chỉ chặn việc
 * GIA HẠN, không chặn access token đang cầm.
 *
 * ---
 * CÁCH LÀM
 *
 * Mỗi lần đổi mật khẩu, ghi mốc thời gian vào `User.passwordChangedAt`. Guard
 * so `iat` của token với mốc đó: token cấp TRƯỚC mốc là token của "thời trước
 * khi đổi" → từ chối.
 *
 * ---
 * VÌ SAO KHÔNG BIẾN NÓ THÀNH MỘT TRUY VẤN MỖI REQUEST
 *
 * Vì đó là một lượt đi database trên đường đi nóng, chỉ để đọc một giá trị gần
 * như không bao giờ đổi. Nên: cache, và **xoá cache ngay trong chính thao tác
 * đổi mật khẩu**. Nhờ vậy hiệu lực là tức thì chứ không phải "sau khi TTL hết".
 *
 * TTL 5 phút chỉ là lưới an toàn cho trường hợp một tiến trình khác đổi mật
 * khẩu mà không đi qua đây (script chạy tay, sửa thẳng SQL).
 */

const CACHE_PREFIX = "secstamp:v1:";
const CACHE_TTL_SECONDS = 300;

/** Không có mốc nào (chưa từng đổi mật khẩu) — mọi token đều hợp lệ. */
const NO_STAMP = 0;

export class SecurityStampService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** `true` khi cơ chế này đang bật (`SESSION_STRICT_REVOCATION`). */
  isEnabled(): boolean {
    return env.SESSION_STRICT_REVOCATION;
  }

  /** Mốc đổi mật khẩu, tính bằng GIÂY epoch — cùng đơn vị với `iat` của JWT. */
  async stampFor(userId: string): Promise<number> {
    const key = `${CACHE_PREFIX}${userId}`;

    const cached = await cacheGet<number>(key);
    if (cached !== null) return cached;

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { passwordChangedAt: true },
    });

    const stamp = user?.passwordChangedAt
      ? Math.floor(user.passwordChangedAt.getTime() / 1000)
      : NO_STAMP;

    await cacheSet(key, stamp, CACHE_TTL_SECONDS);
    return stamp;
  }

  /**
   * Token này còn hiệu lực không.
   *
   * @param issuedAt `iat` của JWT (giây epoch).
   *
   * So sánh dùng `<` chứ không phải `<=`, và đó là chủ đích: `iat` chỉ có độ
   * phân giải GIÂY. Token cấp ở mili-giây 100 và mật khẩu đổi ở mili-giây 900
   * của cùng một giây sẽ có `iat === stamp`. Dùng `<=` thì token vừa cấp trong
   * chính luồng đổi mật khẩu (để giữ phiên hiện tại) cũng bị đá ra.
   */
  async isTokenStillValid(userId: string, issuedAt: number): Promise<boolean> {
    if (!this.isEnabled()) return true;

    return issuedAt >= (await this.stampFor(userId));
  }

  /** Gọi NGAY sau khi ghi `passwordChangedAt`. Quên là hiệu lực trễ tới 5 phút. */
  async invalidate(userId: string): Promise<void> {
    await cacheDel(`${CACHE_PREFIX}${userId}`);
  }
}

/**
 * Instance dùng chung cho toàn ứng dụng.
 *
 * Constructor nhận `prisma` làm THAM SỐ MẶC ĐỊNH chứ không import cứng: chỗ
 * gọi không phải đổi gì, mà test vẫn tiêm được database giả thay vì phải mock
 * cả module `@/lib/prisma`.
 */
export const securityStampService = new SecurityStampService();
