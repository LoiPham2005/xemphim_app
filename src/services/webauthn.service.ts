import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

/**
 * Phản hồi thô từ `navigator.credentials.create()` / `.get()`, nhìn từ bên
 * ngoài package này.
 *
 * Cố ý là `unknown` chứ không phải kiểu của `@simplewebauthn/server`: kiểu đó
 * sẽ rò vào file `.d.ts` mà `packages/core` sinh ra, và lúc đó `apps/api` phải
 * cài thư viện WebAuthn chỉ để BIÊN DỊCH được — dù nó không gọi dòng nào của
 * thư viện đó. Toàn bộ WebAuthn phải nằm gọn trong package này.
 *
 * Ép kiểu diễn ra đúng một chỗ, ngay trước khi gọi thư viện. An toàn vì chính
 * thư viện mới là bên kiểm tra thật: chữ ký, origin, RP ID, challenge — dữ
 * liệu sai hình dạng thì thất bại xác minh, không phải chạy tiếp với rác.
 */
export type WebAuthnClientResponse = unknown;
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { userService } from "./user.service";
import type { PublicUser } from "@/schemas/user.schema";
import { webAuthnConfig } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  ForbiddenError,
  InvalidCredentialsError,
  UserNotFoundError,
  WebAuthnVerificationError,
  assertLoginAllowed,
} from "@/lib/errors";
import { type UserService } from "./user.service";

/**
 * Đăng nhập bằng passkey (WebAuthn / FIDO2).
 *
 * ---
 * VÌ SAO ĐÂY LÀ CÁCH ĐĂNG NHẬP MẠNH NHẤT
 *
 * Khoá riêng không bao giờ rời khỏi thiết bị, và trình duyệt CHỈ ký cho đúng
 * tên miền đã đăng ký. Đó là **chống phishing tuyệt đối**: một trang giả không
 * xin được chữ ký hợp lệ, kể cả khi người dùng bị lừa hoàn toàn và bấm đúng
 * mọi thứ được yêu cầu.
 *
 * Mật khẩu và TOTP đều không có tính chất đó — thứ gì người dùng gõ được vào
 * trang thật thì cũng gõ được vào trang giả, và kẻ tấn công chuyển tiếp sang
 * trang thật trong vài giây.
 *
 * ---
 * MỘT PASSKEY ĐÃ LÀ HAI YẾU TỐ — KHÔNG HỎI THÊM TOTP
 *
 * Đăng nhập với `userVerification: "required"` gồm THIẾT BỊ (khoá riêng trong
 * secure enclave) + SINH TRẮC/PIN (thứ mở khoá enclave đó). Bắt nhập thêm mã
 * TOTP sau đó không tăng thêm an toàn, chỉ khiến người dùng quay về dùng mật
 * khẩu — tức là làm hệ thống YẾU đi.
 *
 * ---
 * CHALLENGE ĐƯỢC GIỮ Ở ĐÂU
 *
 * Không ở đây, và không ở database. Service này SINH ra challenge trong
 * `options`; tầng HTTP ký nó vào một JWT ngắn hạn rồi trả về cho client, và
 * gửi ngược lại ở bước xác minh — cùng khuôn với `state` của OAuth và vé 2FA.
 * Đổi lại: không có bảng nào phải dọn dẹp.
 */

/** Thông tin một passkey, đủ để hiển thị trong danh sách quản lý. */
export type PasskeySummary = {
  id: string;
  name: string | null;
  deviceType: string;
  /** `false` = khoá chưa sao lưu; mất thiết bị là mất hẳn passkey này. */
  backedUp: boolean;
  transports: string[];
  lastUsedAt: Date | null;
  createdAt: Date;
};

export class WebAuthnService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly users: UserService = userService,
  ) {}

  // ---------------------------------------------------------------------------
  // Đăng ký passkey (người dùng ĐANG đăng nhập)
  // ---------------------------------------------------------------------------

  /**
   * Bước 1: sinh tuỳ chọn cho `navigator.credentials.create()`.
   *
   * `excludeCredentials` liệt kê passkey đã có, để trình duyệt TỪ CHỐI đăng ký
   * trùng cùng một authenticator. Thiếu nó thì người dùng bấm "thêm passkey"
   * hai lần trên cùng máy sẽ tạo hai bản ghi cho một thiết bị — và màn quản lý
   * hiện hai dòng giống hệt nhau mà không ai biết xoá dòng nào.
   */
  async createRegistrationOptions(userId: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const config = webAuthnConfig();

    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        email: true,
        username: true,
        profile: { select: { fullName: true } },
        passkeys: { select: { credentialId: true, transports: true } },
      },
    });

    if (!user) throw new UserNotFoundError(userId);

    return generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      // `userID` là BYTE do ta chọn, và nó được lưu trong chính thiết bị. Dùng
      // `user.id` (cuid) chứ KHÔNG dùng email: email đổi được, mà giá trị này
      // thì nằm cứng trong authenticator vĩnh viễn.
      userID: new TextEncoder().encode(userId),
      userName: user.email ?? user.username ?? userId,
      userDisplayName: user.profile?.fullName ?? user.email ?? userId,
      // `none` = không xin giấy chứng nhận nguồn gốc authenticator. Đúng cho
      // gần như mọi ứng dụng dân sự: xin attestation làm trình duyệt hiện thêm
      // một hộp thoại cảnh báo quyền riêng tư, đổi lại một thông tin mà bạn
      // không dùng vào việc gì.
      attestationType: "none",
      excludeCredentials: user.passkeys.map((passkey) => ({
        id: passkey.credentialId,
        transports: passkey.transports as AuthenticatorTransport[],
      })),
      authenticatorSelection: {
        // BẮT BUỘC tạo "discoverable credential": khoá tự mang theo danh tính,
        // nên người dùng đăng nhập được mà KHÔNG cần gõ email trước. Không có
        // nó thì passkey chỉ là yếu tố thứ hai, không thay thế được mật khẩu.
        residentKey: "required",
        // Buộc mở khoá bằng sinh trắc/PIN. Đây là thứ biến một passkey thành
        // hai yếu tố — bỏ đi thì ai cầm được máy đang mở là đăng nhập được.
        userVerification: "required",
      },
    });
  }

  /**
   * Bước 2: xác minh phản hồi và lưu passkey.
   *
   * `expectedChallenge` đến từ tầng HTTP (đã ký trong JWT ngắn hạn). Không
   * kiểm nó thì kẻ tấn công phát lại một phản hồi cũ là đăng ký được passkey
   * của mình vào tài khoản người khác.
   */
  async verifyRegistration(
    userId: string,
    clientResponse: WebAuthnClientResponse,
    expectedChallenge: string,
    name?: string | null,
  ): Promise<PasskeySummary> {
    const config = webAuthnConfig();
    const response = clientResponse as RegistrationResponseJSON;

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: config.origins,
        expectedRPID: config.rpID,
        requireUserVerification: true,
      });
    } catch (error) {
      // Thư viện ném lỗi kèm chi tiết kỹ thuật (sai origin, sai RP ID, chữ ký
      // hỏng). Ghi vào log, nhưng KHÔNG trả ra ngoài: đó là bản đồ cấu hình
      // cho người đang dò.
      logger.warn("Đăng ký passkey thất bại", { userId, reason: String(error) });
      throw new WebAuthnVerificationError();
    }

    if (!verification.verified) throw new WebAuthnVerificationError();

    const { credential, credentialDeviceType, credentialBackedUp, aaguid } =
      verification.registrationInfo;

    const created = await this.db.webAuthnCredential.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: BigInt(credential.counter),
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        transports: response.response.transports ?? [],
        aaguid,
        name: name?.trim() || null,
      },
      select: WebAuthnService.SUMMARY_SELECT,
    });

    logger.info("Đã đăng ký passkey", { userId, deviceType: credentialDeviceType });

    return created;
  }

  // ---------------------------------------------------------------------------
  // Đăng nhập bằng passkey
  // ---------------------------------------------------------------------------

  /**
   * Bước 1: sinh tuỳ chọn cho `navigator.credentials.get()`.
   *
   * KHÔNG truyền `allowCredentials` — đó là điểm mấu chốt của luồng "không cần
   * nhập tên đăng nhập": trình duyệt tự hiện mọi passkey đã lưu cho tên miền
   * này, người dùng chọn một cái, xong.
   *
   * Truyền danh sách vào sẽ buộc phải biết TRƯỚC người dùng là ai — tức là
   * phải có một bước "nhập email" phía trước, và bước đó lại biến endpoint
   * thành công cụ dò xem email nào đã đăng ký.
   */
  createAuthenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return generateAuthenticationOptions({
      rpID: webAuthnConfig().rpID,
      userVerification: "required",
    });
  }

  /**
   * Bước 2: xác minh chữ ký và trả về chủ nhân của passkey.
   *
   * Thứ tự kiểm tra ở đây quan trọng: tra passkey TRƯỚC, kiểm trạng thái tài
   * khoản SAU. Người gọi chưa chứng minh được gì cho tới khi chữ ký hợp lệ, nên
   * mọi thông báo trước đó đều phải giống nhau.
   */
  async verifyAuthentication(
    clientResponse: WebAuthnClientResponse,
    expectedChallenge: string,
  ): Promise<PublicUser> {
    const config = webAuthnConfig();
    const response = clientResponse as AuthenticationResponseJSON;

    const stored = await this.db.webAuthnCredential.findUnique({
      where: { credentialId: response.id },
      select: {
        id: true,
        userId: true,
        publicKey: true,
        counter: true,
        transports: true,
      },
    });

    // Passkey không tồn tại: trả về đúng lỗi mà chữ ký sai trả về. Phân biệt
    // hai trường hợp là xác nhận cho người hỏi biết passkey đó có thật.
    if (!stored) throw new InvalidCredentialsError();

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: config.origins,
        expectedRPID: config.rpID,
        requireUserVerification: true,
        credential: {
          id: response.id,
          publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
          // Thư viện tự so counter và NÉM LỖI khi giá trị nhận về thấp hơn giá
          // trị đã lưu — dấu hiệu authenticator bị nhân bản.
          counter: Number(stored.counter),
          transports: stored.transports,
        },
      });
    } catch (error) {
      logger.warn("Xác minh passkey thất bại", {
        credentialDbId: stored.id,
        userId: stored.userId,
        reason: String(error),
      });
      throw new InvalidCredentialsError();
    }

    if (!verification.verified) throw new InvalidCredentialsError();

    await this.db.webAuthnCredential.update({
      where: { id: stored.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });

    const user = await this.users.findById(stored.userId);
    if (!user) throw new InvalidCredentialsError();

    // BANNED chặn mọi đường đăng nhập. `lockedUntil` thì KHÔNG áp dụng: đó là
    // khoá do dò MẬT KHẨU, mà passkey không dùng mật khẩu — khoá nó ở đây là
    // phạt người dùng vì hành vi của kẻ tấn công.
    assertLoginAllowed(user.status);

    return user;
  }

  // ---------------------------------------------------------------------------
  // Quản lý
  // ---------------------------------------------------------------------------

  private static readonly SUMMARY_SELECT = {
    id: true,
    name: true,
    deviceType: true,
    backedUp: true,
    transports: true,
    lastUsedAt: true,
    createdAt: true,
  } as const;

  async list(userId: string): Promise<PasskeySummary[]> {
    return this.db.webAuthnCredential.findMany({
      where: { userId },
      select: WebAuthnService.SUMMARY_SELECT,
      orderBy: { createdAt: "desc" },
    });
  }

  async rename(id: string, userId: string, name: string): Promise<PasskeySummary> {
    // `userId` trong `where` chứ không phải một phép kiểm tra riêng: id đến từ
    // client, nên thiếu nó là đổi tên được passkey của người khác.
    const result = await this.db.webAuthnCredential.updateMany({
      where: { id, userId },
      data: { name: name.trim() || null },
    });

    if (result.count === 0) throw new UserNotFoundError();

    return this.db.webAuthnCredential.findFirstOrThrow({
      where: { id, userId },
      select: WebAuthnService.SUMMARY_SELECT,
    });
  }

  /**
   * Xoá một passkey.
   *
   * TỪ CHỐI khi đó là cách đăng nhập DUY NHẤT còn lại — không mật khẩu, không
   * provider OAuth, và không passkey nào khác. Xoá xong là mất tài khoản, và
   * không có nút hoàn tác nào.
   */
  async remove(id: string, userId: string): Promise<void> {
    const user = await this.db.user.findFirstOrThrow({
      where: { id: userId },
      select: {
        password: true,
        _count: { select: { oauthAccounts: true, passkeys: true } },
      },
    });

    const isLastWayIn =
      !user.password && user._count.oauthAccounts === 0 && user._count.passkeys <= 1;

    if (isLastWayIn) {
      throw new ForbiddenError(
        "Không xoá được passkey cuối cùng: đây là cách đăng nhập duy nhất còn lại. " +
          "Hãy đặt mật khẩu hoặc thêm một passkey khác trước.",
      );
    }

    const result = await this.db.webAuthnCredential.deleteMany({ where: { id, userId } });

    if (result.count === 0) throw new UserNotFoundError();

    logger.info("Đã xoá passkey", { userId });
  }
}

export const webauthnService = new WebAuthnService();
