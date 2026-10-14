import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { userService } from "./user.service";
import { verificationService } from "./verification.service";
import { tokenService } from "./token.service";
import { securityStampService } from "./security-stamp.service";
import { SYSTEM_ROLES } from "@/lib/permissions";
import { type LoginInput, type RegisterInput } from "@/schemas/auth.schema";
import { type PublicUser } from "@/schemas/user.schema";
import { CryptoUtils } from "@/lib/crypto";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  AccountLockedError,
  DuplicateFieldError,
  InvalidCredentialsError,
  InvalidVerificationTokenError,
  PhoneOtpThrottledError,
  PhoneVerificationDisabledError,
  TwoFactorRequiredError,
  assertLoginAllowed,
} from "@/lib/errors";
import {
  sendEmailChangeNoticeEmail,
  sendEmailChangeVerificationEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/lib/emails";
import { sendPhoneOtpSms } from "@/lib/sms";
import { isPhoneVerificationEnabled } from "@/lib/smser";
import { rateLimit } from "@/lib/rate-limit";
import { PROFILE_SUMMARY_SELECT, type UserService, toPublicUser } from "./user.service";
import type { VerificationService } from "./verification.service";
import type { TokenService } from "./token.service";
import type { SecurityStampService } from "./security-stamp.service";

/**
 * Luồng xác thực: đăng ký, đăng nhập, xác thực email, đặt lại / đổi mật khẩu.
 *
 * ⚠️ Service này KHÔNG ký JWT. Việc đó thuộc về `apps/api` (nơi có
 * `JwtService` của NestJS và biết `JWT_SECRET`) — giữ `packages/core` không
 * phụ thuộc framework, và nhờ vậy `apps/worker` import được nó mà không phải
 * khai `JWT_SECRET`.
 */
export class AuthService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly users: UserService = userService,
    private readonly verification: VerificationService = verificationService,
    private readonly tokens: TokenService = tokenService,
    private readonly securityStamp: SecurityStampService = securityStampService,
  ) {}

  /**
   * Đăng ký công khai.
   *
   * Vai trò LUÔN là USER và KHÔNG đọc từ input — nếu đọc, bất kỳ ai gọi
   * `POST /auth/register` cũng tự phong mình làm ADMIN.
   */
  async register(input: RegisterInput): Promise<PublicUser> {
    const user = await this.users.create({
      email: input.email,
      password: input.password,
      username: input.username,
      fullName: input.fullName,
      status: "ACTIVE",
      roleKeys: [SYSTEM_ROLES.USER],
    });

    // Gửi thư xác thực nhưng KHÔNG chặn việc đăng ký nếu gửi hỏng: tài khoản
    // đã tạo xong rồi, ném lỗi ở đây chỉ khiến người dùng thấy "đăng ký thất
    // bại" cho một thao tác thật ra đã thành công. Họ bấm "gửi lại" được.
    await this.sendEmailVerification(user.id).catch((error: unknown) => {
      logger.error("Không gửi được email xác thực sau khi đăng ký", error, { userId: user.id });
    });

    return user;
  }

  /**
   * Xác thực thông tin đăng nhập.
   *
   * Ba nhánh thất bại — không tìm thấy tài khoản, tài khoản chưa đặt mật khẩu,
   * sai mật khẩu — đều ném CÙNG một lỗi và đều tiêu tốn thời gian như nhau.
   * Nếu không, chỉ cần đo thời gian phản hồi là biết được email nào đã đăng ký.
   *
   * Tài khoản BANNED hoặc đang `lockedUntil` chỉ bị tiết lộ SAU KHI mật khẩu đã
   * đúng. Tiết lộ trước là một oracle: kẻ dò mật khẩu mù sẽ biết tài khoản nào
   * tồn tại/đã bị khoá mà không cần đoán trúng gì.
   */
  async validateCredentials(input: LoginInput): Promise<PublicUser> {
    // Ký tự `@` là thứ duy nhất phân biệt được hai loại: `usernameSchema` cấm
    // `@`, nên một chuỗi có `@` không thể là tên đăng nhập hợp lệ.
    const identifier = input.identifier.trim().toLowerCase();
    const isEmail = identifier.includes("@");

    const user = await this.db.user.findFirst({
      where: {
        deletedAt: null,
        ...(isEmail ? { email: identifier } : { username: identifier }),
      },
      select: {
        id: true,
        email: true,
        phone: true,
        username: true,
        password: true,
        status: true,
        emailVerifiedAt: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        twoFactorEnabledAt: true,
        createdAt: true,
        updatedAt: true,
        profile: { select: PROFILE_SUMMARY_SELECT },
        userRoles: { select: { role: { select: { key: true } } } },
      },
    });

    if (!user) {
      await CryptoUtils.fakeCompare(input.password);
      throw new InvalidCredentialsError();
    }

    const check = await this.verifyPassword(user, input.password);

    assertLoginAllowed(user.status);

    // Đăng nhập đúng sau một chuỗi lần sai — xoá dấu vết, đừng bắt họ trả giá
    // cho những lần gõ nhầm đã qua.
    if (user.failedLoginAttempts > 0) {
      await this.db.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    if (check.needsRehash) await this.upgradePasswordHash(user.id, input.password);

    /*
     * ĐÂY LÀ CỔNG 2FA.
     *
     * Đặt SAU mọi phép kiểm khác có chủ đích: chỉ người đã nhập đúng mật khẩu
     * mới được biết tài khoản này có bật 2FA hay không. Kiểm sớm hơn là biến
     * endpoint đăng nhập thành công cụ dò xem ai đã bật 2FA — thông tin rất
     * hữu ích cho việc chọn mục tiêu.
     *
     * NÉM LỖI thay vì trả về một cờ: nơi gọi KHÔNG THỂ vô tình quên xử lý một
     * exception, còn một trường `twoFactorRequired: true` trong object trả về
     * thì quên rất dễ — và quên nghĩa là 2FA bị bỏ qua hoàn toàn.
     */
    if (user.twoFactorEnabledAt) throw new TwoFactorRequiredError(user.id);

    const { password: _password, failedLoginAttempts: _attempts, ...rest } = user;
    return toPublicUser(rest);
  }

  /**
   * Lấy hồ sơ công khai SAU KHI đã vượt qua 2FA.
   *
   * Tách riêng vì `validateCredentials` cố tình ném lỗi với tài khoản có 2FA
   * nên không trả về user được. Ở đây mật khẩu đã đúng và mã đã đúng — chỉ còn
   * kiểm lại trạng thái tài khoản, phòng trường hợp nó bị khoá trong khoảng
   * vài giây giữa hai bước.
   */
  async completeTwoFactorLogin(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new InvalidCredentialsError();

    assertLoginAllowed(user.status);

    return user;
  }

  /**
   * Kiểm mật khẩu — DÙNG CHUNG cho đăng nhập, đổi email, đổi mật khẩu. Ba luật:
   *
   * 1. Đang bị khoá tạm thì trả `AccountLockedError` NGAY, KHÔNG kiểm mật khẩu. Bản cũ kiểm trước rồi
   *    mới xét khoá: sai -> 401, đúng -> 423. Kẻ dò từ nhiều IP vẫn biết mình đoán TRÚNG giữa lúc khoá,
   *    đợi hết khoá là vào — cơ chế khoá mất đúng mục đích của nó. `fakeCompare` giữ thời gian phản hồi
   *    như khi kiểm thật, để độ trễ cũng không lộ gì.
   * 2. Sai thì LUÔN tăng bộ đếm, ở cả đổi email/đổi mật khẩu — trước đây hai chỗ đó không đếm, ai cầm
   *    được một phiên là dò mật khẩu thật không giới hạn.
   * 3. Tài khoản chưa đặt mật khẩu (chỉ OAuth) trả cùng lỗi với sai mật khẩu.
   *
   * Còn lại một rò rỉ chấp nhận được: tài khoản đang khoá trả 423 còn email không tồn tại trả 401 — biết
   * được "email này có tài khoản". Muốn kín hẳn thì phải giả lập khoá cho cả email không tồn tại.
   */
  private async verifyPassword(
    user: { id: string; password: string | null; lockedUntil: Date | null },
    password: string,
  ): Promise<{ needsRehash: boolean }> {
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await CryptoUtils.fakeCompare(password);
      throw new AccountLockedError(user.lockedUntil);
    }

    if (!user.password) {
      await CryptoUtils.fakeCompare(password);
      throw new InvalidCredentialsError();
    }

    const check = await CryptoUtils.verifyPassword(password, user.password);
    if (!check.valid) {
      await this.registerFailedAttempt(user.id);
      throw new InvalidCredentialsError();
    }
    return check;
  }

  /**
   * Tăng bộ đếm sai mật khẩu; khoá tạm khi chạm ngưỡng.
   *
   * Bổ sung cho rate-limit theo IP: rate-limit chặn MỘT IP dò NHIỀU tài khoản,
   * còn cái này chặn NHIỀU IP cùng dò MỘT tài khoản.
   *
   * Chỉ được gọi khi tài khoản KHÔNG đang bị khoá (`verifyPassword` chặn trước) — nên request dồn tới
   * trong lúc khoá không đẩy `lockedUntil` lùi thêm vô hạn.
   */
  private async registerFailedAttempt(userId: string): Promise<void> {
    const updated = await this.db.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });

    if (updated.failedLoginAttempts >= env.LOGIN_MAX_FAILED_ATTEMPTS) {
      await this.db.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: new Date(Date.now() + env.LOGIN_LOCKOUT_MINUTES * 60 * 1000),
        },
      });
    }
  }

  /**
   * Băm lại mật khẩu bằng THAM SỐ hiện hành và ghi đè.
   *
   * Chạy khi bạn siết tham số Argon2 (ví dụ nâng `memoryCost` để theo kịp phần
   * cứng mới): mỗi lần đăng nhập thành công là một bản ghi được nâng cấp, và
   * không ai phải đổi mật khẩu.
   *
   * Lỗi ở đây bị nuốt CÓ CHỦ ĐÍCH. Người dùng vừa nhập đúng mật khẩu — chặn họ
   * đăng nhập chỉ vì thao tác nâng cấp nền phía sau thất bại là hành vi sai.
   */
  private async upgradePasswordHash(userId: string, plainPassword: string): Promise<void> {
    try {
      const password = await CryptoUtils.hashPassword(plainPassword);
      await this.db.user.update({ where: { id: userId }, data: { password } });
    } catch (error) {
      logger.error("Không nâng cấp được hash mật khẩu", error, { userId });
    }
  }

  // -------------------------------------------------------------------------
  // Xác thực email
  // -------------------------------------------------------------------------

  /**
   * Cấp token xác thực và gửi email. Không làm gì nếu email đã được xác thực —
   * tránh việc bấm nhầm nút "gửi lại" làm mất hiệu lực trạng thái đang đúng.
   */
  async sendEmailVerification(userId: string): Promise<void> {
    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true, emailVerifiedAt: true },
    });

    if (!user?.email || user.emailVerifiedAt) return;

    const { token } = await this.verification.issue(user.id, "EMAIL_VERIFICATION");
    await sendVerificationEmail(user.email, token);
  }

  /**
   * Gửi lại thư xác thực theo địa chỉ email.
   *
   * KHÔNG bao giờ tiết lộ email có tồn tại hay không — endpoint này công khai,
   * và bất kỳ khác biệt nào cũng biến nó thành công cụ dò danh sách người dùng.
   */
  async resendEmailVerification(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) return;
    await this.sendEmailVerification(user.id);
  }

  /**
   * Xác thực email bằng token trong link.
   *
   * Ghi `emailVerifiedAt` CHỈ KHI nó đang null: người dùng bấm lại link cũ sau
   * khi đã xác thực thì không được ghi đè mốc thời gian ban đầu.
   */
  async verifyEmail(token: string): Promise<PublicUser> {
    const consumed = await this.verification.consume(token, "EMAIL_VERIFICATION");
    if (!consumed) throw new InvalidVerificationTokenError();

    await this.db.user.updateMany({
      where: { id: consumed.userId, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });

    const user = await this.users.findById(consumed.userId);
    if (!user) throw new InvalidVerificationTokenError();

    return user;
  }

  // -------------------------------------------------------------------------
  // Đặt lại / đổi mật khẩu
  // -------------------------------------------------------------------------

  /**
   * Gửi link đặt lại mật khẩu.
   *
   * ⚠️ KHÔNG BAO GIỜ báo cho bên gọi biết email có tồn tại hay không.
   *
   * Tài khoản chưa đặt mật khẩu (admin tạo hộ, hoặc chỉ đăng nhập qua OAuth)
   * VẪN được cấp link: đó chính là cách hợp lệ để họ đặt mật khẩu lần đầu.
   */
  async requestPasswordReset(email: string): Promise<void> {
    // Đi qua `users.findByEmail` thay vì tự viết truy vấn, vì nó giữ hai luật
    // mà chỗ này rất dễ bỏ sót — và cả hai đều hỏng trong im lặng: chuẩn hoá
    // chữ thường, và bỏ qua tài khoản đã xoá mềm.
    const user = await this.users.findByEmail(email);
    if (!user?.email) return;

    const { token } = await this.verification.issue(user.id, "PASSWORD_RESET");
    await sendPasswordResetEmail(user.email, token);
  }

  /**
   * Đặt mật khẩu mới bằng token trong link.
   *
   * Thu hồi TOÀN BỘ refresh token sau khi đổi. Đây là phần bắt buộc, không phải
   * tuỳ chọn: kịch bản điển hình của luồng này là tài khoản đã bị chiếm. Đổi
   * mật khẩu mà để phiên cũ của kẻ tấn công còn sống thì việc đổi gần như vô
   * nghĩa.
   */
  async resetPassword(token: string, newPassword: string): Promise<string> {
    const consumed = await this.verification.consume(token, "PASSWORD_RESET");
    if (!consumed) throw new InvalidVerificationTokenError();

    const userId = consumed.userId;
    const password = await CryptoUtils.hashPassword(newPassword);

    const user = await this.db.user.update({
      where: { id: userId },
      data: {
        password,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
      select: { id: true, email: true },
    });

    await this.tokens.revokeAllForUser(userId);
    // Refresh token đã thu hồi ở trên, nhưng access token đang cầm thì chưa —
    // dòng này mới là thứ đá kẻ tấn công ra NGAY thay vì sau 15 phút.
    await this.securityStamp.invalidate(userId);

    if (user.email) {
      await sendPasswordChangedEmail(user.email).catch((error: unknown) => {
        logger.error("Không gửi được email thông báo đổi mật khẩu", error, { userId });
      });
    }

    logger.info("Mật khẩu được đặt lại", { userId });
    return userId;
  }

  // -------------------------------------------------------------------------
  // Đổi địa chỉ email
  // -------------------------------------------------------------------------

  /**
   * Bước 1: xin đổi sang một địa chỉ email mới.
   *
   * ---
   * VÌ SAO KHÔNG GHI THẲNG VÀO `user.email`
   *
   * Đổi email là đường chiếm tài khoản kinh điển: chiếm được phiên đăng nhập
   * một lúc, đổi email sang địa chỉ của mình, rồi dùng "quên mật khẩu" để
   * chiếm vĩnh viễn. Chủ thật mất tài khoản mà không nhận được thông báo nào.
   *
   * Nên có ba chốt:
   *   1. Bắt nhập lại MẬT KHẨU hiện tại.
   *   2. Địa chỉ MỚI phải tự xác thực (link gửi tới đó) trước khi thay thế.
   *   3. Địa chỉ CŨ được gửi thư báo NGAY — đó là tín hiệu duy nhất mà chủ
   *      thật nhận được nếu tài khoản đã bị chiếm.
   */
  async requestEmailChange(userId: string, newEmail: string, password: string): Promise<void> {
    const normalized = newEmail.trim().toLowerCase();

    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true, password: true, lockedUntil: true },
    });

    if (!user) {
      await CryptoUtils.fakeCompare(password);
      throw new InvalidCredentialsError();
    }

    await this.verifyPassword(user, password);

    // Kiểm sớm để báo lỗi tử tế. Ràng buộc thật nằm ở partial unique index của
    // database, áp lúc `confirmEmailChange` ghi vào — giữa hai thời điểm đó
    // vẫn có khe cho người khác đăng ký trước.
    const taken = await this.db.user.findFirst({
      where: { email: normalized, deletedAt: null, NOT: { id: userId } },
      select: { id: true },
    });
    if (taken) throw new DuplicateFieldError("email", normalized);

    const { token } = await this.verification.issue(userId, "EMAIL_CHANGE", normalized);

    await sendEmailChangeVerificationEmail(normalized, token);

    if (user.email) {
      // Gửi tới địa chỉ CŨ. Không chặn luồng nếu gửi hỏng — nhưng phải ghi log,
      // vì đây là cảnh báo an ninh chứ không phải thư xã giao.
      await sendEmailChangeNoticeEmail(user.email, normalized).catch((error: unknown) => {
        logger.error("Không gửi được thư báo đổi email tới địa chỉ cũ", error, { userId });
      });
    }
  }

  /**
   * Bước 2: xác nhận bằng link gửi tới địa chỉ MỚI.
   *
   * Thu hồi mọi phiên sau khi đổi: email là danh tính khôi phục tài khoản, nên
   * đổi nó xong mà để phiên cũ còn sống thì kẻ đã chiếm phiên vẫn ở nguyên đó.
   */
  async confirmEmailChange(token: string): Promise<PublicUser> {
    const consumed = await this.verification.consume(token, "EMAIL_CHANGE");
    if (!consumed?.destination) throw new InvalidVerificationTokenError();

    try {
      await this.db.user.update({
        where: { id: consumed.userId },
        data: {
          email: consumed.destination,
          // Địa chỉ này vừa tự chứng minh quyền sở hữu bằng chính link vừa bấm.
          emailVerifiedAt: new Date(),
          pendingEmail: null,
          // Mốc thu hồi phiên (tên cột có chữ "password" vì sinh ra cho đổi mật khẩu, nhưng nghĩa thật là
          // "mọi token cấp trước mốc này đều chết"). Thiếu dòng này thì `securityStamp.invalidate` bên
          // dưới vô tác dụng: access token của kẻ đang chiếm phiên sống thêm tới ~15 phút.
          passwordChangedAt: new Date(),
        },
      });
    } catch (error) {
      // Ai đó đã đăng ký địa chỉ này trong lúc chờ — partial unique index chặn.
      if ((error as { code?: string }).code === "P2002") {
        throw new DuplicateFieldError("email", consumed.destination);
      }
      throw error;
    }

    await this.tokens.revokeAllForUser(consumed.userId);
    // Refresh token chết ở dòng trên; access token đang cầm chết ở dòng này — giống `resetPassword`.
    await this.securityStamp.invalidate(consumed.userId);

    const user = await this.users.findById(consumed.userId);
    if (!user) throw new InvalidVerificationTokenError();

    logger.info("Đã đổi địa chỉ email", { userId: consumed.userId });
    return user;
  }

  // -------------------------------------------------------------------------
  // Xác thực số điện thoại (SMS)
  // -------------------------------------------------------------------------

  /**
   * Gửi mã OTP tới số điện thoại mà người dùng muốn gắn vào tài khoản.
   *
   * ---
   * BA LỚP CHẶN LẠM DỤNG, VÀ VÌ SAO CẦN ĐỦ CẢ BA
   *
   * Đây là endpoint DUY NHẤT trong bộ khung có chi phí trực tiếp trên mỗi lần
   * gọi. Một lỗ hổng ở đây không dẫn tới mất dữ liệu — nó dẫn tới một hoá đơn.
   *
   *   1. Rate limit theo IP — do `@RateLimit("phoneOtp")` ở tầng HTTP lo.
   *      Chặn một máy bắn liên tục. KHÔNG chặn được kẻ xoay vòng IP.
   *   2. **Giãn cách theo SỐ ĐIỆN THOẠI** (mặc định 60 giây). Chặn "SMS
   *      bombing": nhiều IP cùng dội mã vào một nạn nhân để quấy rối.
   *   3. **Trần theo NGÀY trên số điện thoại** (mặc định 5). Chặn kẻ kiên nhẫn
   *      gửi đều tay suốt 24 giờ.
   *
   * Lớp 2 và 3 khoá theo SỐ, không theo người dùng — vì kẻ tấn công tạo được
   * nhiều tài khoản, nhưng số điện thoại nạn nhân thì chỉ có một.
   */
  async requestPhoneVerification(userId: string, phone: string): Promise<void> {
    if (!isPhoneVerificationEnabled()) throw new PhoneVerificationDisabledError();

    const normalized = normalizePhone(phone);

    // Kiểm TRƯỚC khi gửi: báo lỗi tử tế, và quan trọng hơn — không tiêu một tin
    // nhắn cho một số mà cuối cùng vẫn không gắn được.
    const taken = await this.db.user.findFirst({
      where: { phone: normalized, deletedAt: null, NOT: { id: userId } },
      select: { id: true },
    });
    if (taken) throw new DuplicateFieldError("phone", normalized);

    const cooldown = await rateLimit(`otp:cooldown:${normalized}`, {
      limit: 1,
      windowSeconds: env.PHONE_OTP_RESEND_COOLDOWN_SECONDS,
    });
    if (!cooldown.success) throw new PhoneOtpThrottledError(cooldown.retryAfterSeconds);

    const daily = await rateLimit(`otp:daily:${normalized}`, {
      limit: env.PHONE_OTP_MAX_PER_DAY,
      windowSeconds: 24 * 60 * 60,
    });
    if (!daily.success) throw new PhoneOtpThrottledError(daily.retryAfterSeconds);

    // `destination` giữ số điện thoại đang chờ — đúng khuôn `EMAIL_CHANGE`.
    // Số chỉ được ghi vào `user.phone` sau khi mã được xác nhận.
    const { token } = await this.verification.issue(userId, "PHONE_OTP", normalized);

    await sendPhoneOtpSms(normalized, token);
  }

  /**
   * Xác nhận mã OTP và gắn số điện thoại vào tài khoản.
   *
   * Số điện thoại lấy từ `destination` của chính bản ghi token, KHÔNG nhận lại
   * từ client — nếu nhận, người dùng gửi mã của số A kèm số B là gắn được số
   * chưa hề xác thực.
   */
  async confirmPhoneVerification(userId: string, code: string): Promise<PublicUser> {
    if (!isPhoneVerificationEnabled()) throw new PhoneVerificationDisabledError();

    const pending = await this.db.verificationToken.findFirst({
      where: { userId, type: "PHONE_OTP", usedAt: null },
      orderBy: { createdAt: "desc" },
      select: { destination: true },
    });

    if (!pending?.destination) throw new InvalidVerificationTokenError();

    // `consumeOtp` băm kèm `userId` và tự đếm số lần nhập sai — xem
    // `VerificationService`.
    if (!(await this.verification.consumeOtp(userId, "PHONE_OTP", code))) {
      throw new InvalidVerificationTokenError();
    }

    try {
      await this.db.user.update({
        where: { id: userId },
        data: { phone: pending.destination, phoneVerifiedAt: new Date() },
      });
    } catch (error) {
      // Ai đó vừa đăng ký số này trong lúc chờ — partial unique index chặn.
      if ((error as { code?: string }).code === "P2002") {
        throw new DuplicateFieldError("phone", pending.destination);
      }
      throw error;
    }

    const user = await this.users.findById(userId);
    if (!user) throw new InvalidVerificationTokenError();

    logger.info("Đã xác thực số điện thoại", { userId });
    return user;
  }

  /**
   * Đổi mật khẩu khi đang đăng nhập.
   *
   * Bắt nhập lại mật khẩu hiện tại DÙ đã đăng nhập: nếu không, ai ngồi vào máy
   * đang mở sẵn phiên là chiếm được tài khoản vĩnh viễn.
   *
   * @param keepFamilyId Phiên được giữ lại — chính là phiên đang thực hiện
   * thao tác này. Không có tham số này thì người dùng bị đăng xuất khỏi chính
   * thiết bị họ vừa thao tác, một trải nghiệm trông y như lỗi.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    keepFamilyId?: string,
  ): Promise<void> {
    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true, password: true, lockedUntil: true },
    });

    if (!user) {
      await CryptoUtils.fakeCompare(currentPassword);
      throw new InvalidCredentialsError();
    }

    await this.verifyPassword(user, currentPassword);

    const password = await CryptoUtils.hashPassword(newPassword);

    await this.db.user.update({
      where: { id: userId },
      data: { password, passwordChangedAt: new Date() },
    });
    await this.tokens.revokeAllForUser(userId, { exceptFamilyId: keepFamilyId });
    await this.securityStamp.invalidate(userId);

    if (user.email) {
      await sendPasswordChangedEmail(user.email).catch((error: unknown) => {
        logger.error("Không gửi được email thông báo đổi mật khẩu", error, { userId });
      });
    }

    logger.info("Mật khẩu được đổi", { userId });
  }
}

/**
 * Chuẩn hoá số điện thoại về một dạng duy nhất trước khi lưu hoặc tra cứu.
 *
 * `0912345678` và `+84912345678` là CÙNG một số, nhưng với database thì là hai
 * chuỗi khác nhau. Không chuẩn hoá thì cùng một người đăng ký được hai lần, và
 * trần OTP theo ngày bị lách chỉ bằng cách đổi cách viết.
 *
 * Quy về dạng `0…` vì đó là dạng người Việt gõ và là dạng nhà cung cấp SMS
 * trong nước nhận.
 */
function normalizePhone(phone: string): string {
  const digits = phone.trim().replace(/[\s.-]/g, "");
  return digits.startsWith("+84") ? `0${digits.slice(3)}` : digits;
}

export const authService = new AuthService();
