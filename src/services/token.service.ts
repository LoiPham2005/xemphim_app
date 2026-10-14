import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { generateOpaqueToken, hashOpaqueToken } from "@/lib/opaque-token";
import { randomUUID } from "node:crypto";
import { RefreshTokenReuseError } from "@/lib/errors";

/**
 * Vòng đời refresh token.
 *
 * Ba tính chất quan trọng, theo đúng thứ tự ưu tiên:
 *
 * 1. Database chỉ lưu SHA-256 của token. Rò database KHÔNG đồng nghĩa với rò
 *    phiên đăng nhập.
 * 2. Token XOAY VÒNG mỗi lần refresh — token cũ bị thu hồi ngay.
 * 3. Dùng lại một token đã bị thu hồi sẽ huỷ TOÀN BỘ phiên của tài khoản đó.
 *    Token đã xoay vòng mà còn được dùng lại chỉ có một cách giải thích hợp lý:
 *    nó đã bị đánh cắp. Lúc đó không thể biết bên nào là kẻ trộm, nên đá cả hai
 *    ra là phản ứng đúng.
 */

export type IssuedRefreshToken = {
  /** Chuỗi gốc — chỉ tồn tại trong response này, không lưu ở đâu cả. */
  token: string;
  expiresAt: Date;
  /** Id của chính bản ghi vừa tạo. Đổi sau mỗi lần xoay vòng. */
  id: string;
  /**
   * ĐỊNH DANH PHIÊN — không đổi xuyên suốt mọi lần xoay vòng.
   *
   * KHÔNG phải bí mật: biết nó cũng không đăng nhập được, vì token thật đã băm
   * SHA-256 trước khi lưu.
   *
   * Đây mới là giá trị client nên giữ để nhận ra "thiết bị này" trong danh
   * sách phiên. Dùng `id` thay thế thì nó đổi sau mỗi lần refresh, và client
   * phải cập nhật liên tục — một wart mà mọi hệ thống rotation đều gặp nếu
   * thiếu cột này.
   */
  familyId: string;
};

export type ActiveSession = {
  /** `familyId` — ổn định, dùng để thu hồi. KHÔNG phải id của bản ghi token. */
  id: string;
  /** Chuỗi User-Agent thô. Việc dịch sang "iPhone · Safari" để client lo. */
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  expiresAt: Date;
};

export type RefreshContext = {
  userAgent?: string | null;
  ip?: string | null;
  deviceId?: string | null;
  /** Thời điểm phiên này vượt qua 2FA. `null` = chưa/không cần. */
  twoFactorAt?: Date | null;
};

export class TokenService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Cấp token cho một phiên MỚI (đăng nhập lần đầu trên một thiết bị).
   *
   * @param familyId Chỉ truyền khi đang XOAY VÒNG một phiên có sẵn. Bỏ trống
   * thì một họ mới được mở — `randomUUID` chứ không dùng lại `id` của bản ghi,
   * để họ có định danh riêng không phụ thuộc vào token đầu tiên (token đó rồi
   * cũng bị xoá khi dọn dẹp).
   */
  async issue(
    userId: string,
    context: RefreshContext = {},
    familyId?: string,
  ): Promise<IssuedRefreshToken> {
    const token = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const family = familyId ?? randomUUID();

    const created = await this.db.refreshToken.create({
      data: {
        tokenHash: hashOpaqueToken(token),
        familyId: family,
        userId,
        expiresAt,
        userAgent: context.userAgent ?? null,
        ip: context.ip ?? null,
        deviceId: context.deviceId ?? null,
        twoFactorAt: context.twoFactorAt ?? null,
      },
      select: { id: true },
    });

    return { token, expiresAt, id: created.id, familyId: family };
  }

  /**
   * Đổi refresh token lấy token mới.
   *
   * Trả `null` khi token không dùng được vì lý do thông thường (không tồn tại,
   * hết hạn) — nơi gọi chỉ cần biết "phải đăng nhập lại". NÉM lỗi riêng cho
   * trường hợp dùng lại token đã thu hồi, vì đó là dấu hiệu tấn công và cần
   * được ghi nhật ký khác hẳn.
   */
  async rotate(
    token: string,
    context: RefreshContext = {},
  ): Promise<{ userId: string; refresh: IssuedRefreshToken } | null> {
    const existing = await this.db.refreshToken.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      select: {
        id: true,
        userId: true,
        familyId: true,
        revokedAt: true,
        expiresAt: true,
        deviceId: true,
        twoFactorAt: true,
        user: { select: { status: true, deletedAt: true } },
      },
    });

    if (!existing) return null;

    if (existing.revokedAt) {
      /*
       * Thu hồi đúng MỘT HỌ, không phải toàn bộ phiên của tài khoản.
       *
       * Token bị dùng lại là dấu hiệu MỘT thiết bị bị đánh cắp. Đá người dùng
       * ra khỏi cả điện thoại lẫn máy tính lẫn máy tính bảng chỉ vì một trong
       * số đó bị lộ là phản ứng quá tay — và nó khiến người ta ngại báo sự cố.
       *
       * Cả kẻ trộm lẫn thiết bị thật đều nằm trong họ này (chúng dùng chung
       * chuỗi token), nên cả hai cùng bị đá ra: đúng như mong muốn, vì không
       * cách nào biết bên nào là bên nào.
       */
      await this.revokeFamily(existing.familyId);
      throw new RefreshTokenReuseError(existing.userId);
    }

    if (existing.expiresAt <= new Date()) return null;

    // Token còn hạn nhưng chủ nhân đã bị khoá/xoá trong lúc đó. Không kiểm ở
    // đây thì tài khoản bị ban vẫn tự gia hạn phiên vô thời hạn.
    if (existing.user.deletedAt || existing.user.status === "BANNED") return null;

    await this.db.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    const refresh = await this.issue(
      existing.userId,
      {
        ...context,
        // Giữ nguyên thiết bị của phiên cũ nếu lần refresh này không khai báo —
        // nếu không, mỗi lần refresh là phiên mất dấu thiết bị.
        deviceId: context.deviceId ?? existing.deviceId,
        // 2FA đã vượt qua thì vượt qua cho cả phiên. Không mang theo giá trị
        // này là mỗi lần refresh lại thành "phiên chưa qua 2FA".
        twoFactorAt: context.twoFactorAt ?? existing.twoFactorAt,
      },
      // ĐÚNG họ cũ — đây là điều làm cho id phiên ổn định với client.
      existing.familyId,
    );

    return { userId: existing.userId, refresh };
  }

  /** Đăng xuất một thiết bị. Token không tồn tại cũng coi là thành công. */
  async revoke(token: string): Promise<void> {
    await this.db.refreshToken.updateMany({
      where: { tokenHash: hashOpaqueToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Danh sách phiên còn hiệu lực.
   *
   * "Còn hiệu lực" = chưa thu hồi VÀ chưa hết hạn. Token đã xoay vòng vẫn nằm
   * trong bảng (có `revokedAt`) nhưng KHÔNG được hiện ra: mỗi lần refresh sinh
   * một dòng mới, nên hiện hết thì một chiếc điện thoại dùng một tháng sẽ xuất
   * hiện thành hàng trăm "thiết bị".
   */
  async listActive(userId: string): Promise<ActiveSession[]> {
    const rows = await this.db.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        familyId: true,
        userAgent: true,
        ip: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    /*
     * Gom theo họ và chỉ giữ bản ghi MỚI NHẤT của mỗi họ.
     *
     * Trong điều kiện bình thường mỗi họ chỉ có đúng một token chưa thu hồi.
     * Nhưng một lần ghi hỏng giữa chừng, hoặc hai request refresh chạy song
     * song, có thể để lại hai dòng — và lúc đó màn hình "thiết bị đang đăng
     * nhập" sẽ hiện chiếc điện thoại của người dùng thành hai thiết bị.
     *
     * `createdAt` của bản ghi mới nhất cũng là thứ nên hiển thị: nó xấp xỉ
     * "lần hoạt động gần nhất", hữu ích hơn nhiều so với thời điểm đăng nhập
     * lần đầu.
     */
    const byFamily = new Map<string, ActiveSession>();

    for (const row of rows) {
      if (byFamily.has(row.familyId)) continue;
      byFamily.set(row.familyId, {
        id: row.familyId,
        userAgent: row.userAgent,
        ip: row.ip,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      });
    }

    return [...byFamily.values()];
  }

  /**
   * Thu hồi MỘT phiên — nút "đăng xuất thiết bị này".
   *
   * Nhận `familyId` (thứ mà client nhìn thấy trong danh sách phiên), nên nó
   * thu hồi cả chuỗi token của thiết bị đó chứ không chỉ bản ghi hiện tại.
   *
   * ⚠️ `userId` nằm trong điều kiện `where` chứ không phải một phép kiểm tra
   * riêng phía trên. Đây là điểm mấu chốt: id đến từ client, nên không có ràng
   * buộc này thì bất kỳ ai cũng đăng xuất được thiết bị của người khác chỉ bằng
   * cách đoán id.
   *
   * Trả `false` khi không có gì bị thu hồi — id không tồn tại, thuộc người
   * khác, hoặc đã thu hồi rồi. Cố ý KHÔNG phân biệt ba trường hợp đó.
   */
  async revokeById(familyId: string, userId: string): Promise<boolean> {
    const result = await this.db.refreshToken.updateMany({
      where: { familyId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return result.count > 0;
  }

  /** Thu hồi cả một họ. Dùng khi phát hiện token trong họ đó bị dùng lại. */
  async revokeFamily(familyId: string): Promise<number> {
    const result = await this.db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /** Đăng xuất mọi thiết bị. Dùng khi đổi mật khẩu hoặc phát hiện token bị dùng lại. */
  /**
   * @param options.exceptFamilyId Họ được GIỮ LẠI — thường là phiên đang thực
   * hiện thao tác. Thiếu nó thì đổi mật khẩu sẽ đăng xuất luôn chính thiết bị
   * người dùng đang cầm, một trải nghiệm trông y như lỗi.
   */
  async revokeAllForUser(
    userId: string,
    options: { exceptFamilyId?: string } = {},
  ): Promise<number> {
    const result = await this.db.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(options.exceptFamilyId ? { NOT: { familyId: options.exceptFamilyId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /**
   * Dọn token đã hết hạn. Gọi định kỳ bằng job nền — bảng này CHỈ TĂNG: mỗi
   * lần đăng nhập, mỗi lần refresh là thêm một dòng.
   */
  async purgeExpired(): Promise<number> {
    const result = await this.db.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          // Token đã thu hồi từ lâu cũng không còn giá trị điều tra.
          { revokedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
        ],
      },
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
export const tokenService = new TokenService();
