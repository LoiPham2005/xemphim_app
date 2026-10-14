import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { userService } from "./user.service";
import { SYSTEM_ROLES } from "@/lib/permissions";
import { type PublicUser } from "@/schemas/user.schema";
import {
  AccountBannedError,
  ForbiddenError,
  OAuthEmailRequiredError,
  assertLoginAllowed,
} from "@/lib/errors";
import { PROFILE_SUMMARY_SELECT, type UserService, toPublicUser } from "./user.service";
import type { OAuthProfile } from "@/lib/oauth/types";

/**
 * Quy một hồ sơ OAuth đã chuẩn hoá về một `PublicUser`.
 *
 * Ba đường, theo đúng thứ tự ưu tiên:
 *
 *   1. `provider` + `providerAccountId` đã từng đăng nhập → user cũ, xong.
 *   2. Chưa từng, nhưng email trùng với user có sẵn (đăng ký bằng mật khẩu
 *      trước đó, hoặc đã liên kết provider khác) → LIÊN KẾT vào user đó.
 *   3. Chưa từng, email cũng chưa ai dùng → tạo user mới.
 *
 * Chỉ tin email khi provider xác nhận đã xác thực (`client.ts` đã lọc theo điều
 * kiện đó) — liên kết theo một email chưa xác thực là mở đường chiếm tài khoản
 * người khác bằng chính email của họ.
 */
export class OAuthService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly users: UserService = userService,
  ) {}

  async loginWithProfile(rawProfile: OAuthProfile): Promise<PublicUser> {
    /*
     * Chuẩn hoá email NGAY Ở CỬA.
     *
     * Google/Apple trả về đúng thứ người dùng đã gõ khi đăng ký — kể cả
     * `Loi@Gmail.com`. Còn `email` trong database luôn ở dạng chữ thường (do
     * `emailSchema` của Zod ép), và mọi truy vấn tra cứu cũng lowercase.
     *
     * Không chuẩn hoá ở đây thì: người dùng đã có tài khoản `loi@gmail.com`,
     * bấm "Đăng nhập bằng Google", provider trả `Loi@Gmail.com` → tra không ra
     * → hệ thống TẠO TÀI KHOẢN MỚI thay vì liên kết. Họ mất sạch dữ liệu cũ mà
     * không hiểu vì sao.
     */
    const profile: OAuthProfile = {
      ...rawProfile,
      email: rawProfile.email?.trim().toLowerCase() ?? null,
    };

    const user = await this.resolveUser(profile);

    // BANNED chặn mọi cách đăng nhập, kể cả OAuth. `lockedUntil` thì KHÔNG áp
    // dụng ở đây — đó là khoá do brute-force MẬT KHẨU, không liên quan gì tới
    // việc đăng nhập bằng Google/GitHub.
    assertLoginAllowed(user.status);

    return user;
  }

  private async resolveUser(profile: OAuthProfile): Promise<PublicUser> {
    const linked = await this.db.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      },
      select: { userId: true },
    });

    if (linked) {
      const user = await this.users.findById(linked.userId, { includeDeleted: true });
      // Tài khoản đã xoá mềm nhưng liên kết OAuth còn sót lại. Không dọn liên
      // kết ở đây (xoá mềm giữ lại dữ liệu có chủ đích), chỉ từ chối đăng nhập.
      if (!user) throw new AccountBannedError();
      return user;
    }

    if (!profile.email) throw new OAuthEmailRequiredError(profile.provider);

    const existing = await this.users.findByEmail(profile.email);

    if (existing) {
      await this.db.oAuthAccount.create({
        data: {
          userId: existing.id,
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      });
      return existing;
    }

    // Tài khoản mới: email đã được provider xác thực nên đánh dấu luôn — bắt
    // họ xác thực lại một địa chỉ mà Google vừa xác nhận là thừa.
    const created = await this.db.user.create({
      data: {
        email: profile.email,
        emailVerifiedAt: new Date(),
        // Không có mật khẩu: họ đăng nhập bằng provider. Muốn đặt mật khẩu thì
        // đi qua luồng "quên mật khẩu" — nó chấp nhận tài khoản chưa có mật khẩu.
        password: null,
        profile: { create: { fullName: profile.fullName } },
        userRoles: { create: { role: { connect: { key: SYSTEM_ROLES.USER } } } },
        oauthAccounts: {
          create: { provider: profile.provider, providerAccountId: profile.providerAccountId },
        },
      },
      select: {
        id: true,
        email: true,
        phone: true,
        username: true,
        status: true,
        emailVerifiedAt: true,
        lockedUntil: true,
        twoFactorEnabledAt: true,
        createdAt: true,
        updatedAt: true,
        profile: { select: PROFILE_SUMMARY_SELECT },
        userRoles: { select: { role: { select: { key: true } } } },
      },
    });

    return toPublicUser(created);
  }

  /** Danh sách provider người dùng đã liên kết — cho màn "tài khoản liên kết". */
  async listLinked(userId: string) {
    return this.db.oAuthAccount.findMany({
      where: { userId },
      select: { provider: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Gỡ liên kết.
   *
   * Từ chối khi đó là cách đăng nhập DUY NHẤT còn lại (không có mật khẩu, không
   * còn provider nào khác) — gỡ xong là mất tài khoản, và không có nút hoàn tác.
   */
  async unlink(userId: string, provider: string): Promise<void> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { password: true, _count: { select: { oauthAccounts: true } } },
    });

    if (!user.password && user._count.oauthAccounts <= 1) {
      throw new ForbiddenError(
        `Không gỡ được liên kết ${provider}: đây là cách đăng nhập duy nhất còn lại. ` +
          `Hãy đặt mật khẩu hoặc liên kết thêm một nhà cung cấp khác trước.`,
      );
    }

    await this.db.oAuthAccount.deleteMany({ where: { userId, provider } });
  }
}

export const oauthService = new OAuthService();
