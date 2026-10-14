import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { env, isProduction } from "./env";

/**
 * Ký và xác thực session token (JWT).
 *
 * File này cố ý KHÔNG import `next/headers` hay Prisma: nó chạy được ở cả ba
 * chỗ — Proxy, Server Component, và route handler cho mobile. Phần dính cookie
 * nằm riêng trong `auth.ts`, phần dính header Authorization nằm trong
 * `api/auth.ts`. Nhờ vậy thêm client mới không phải sửa file này.
 */

export const SESSION_COOKIE_NAME = "session";

const ALGORITHM = "HS256";
const secretKey = new TextEncoder().encode(env.SESSION_SECRET);

/** Hạn của cookie session trên web. */
export const SESSION_MAX_AGE_SECONDS = env.SESSION_MAX_AGE_DAYS * 24 * 60 * 60;

/**
 * Hạn của access token cấp cho client mobile — ngắn hơn hẳn cookie web.
 *
 * JWT đã ký thì không thu hồi được, nên hạn càng dài thì cửa sổ thiệt hại khi
 * lộ token càng lớn. Bù lại bằng refresh token (xem `token.service.ts`): nó
 * lưu trong database nên thu hồi được ngay lập tức.
 */
export const ACCESS_TOKEN_MAX_AGE_SECONDS = env.ACCESS_TOKEN_TTL_MINUTES * 60;

const sessionPayloadSchema = z.object({
  /**
   * Loại token. Có mặt trong MỌI JWT mà hệ thống ký.
   *
   * Hệ thống ký nhiều loại bằng CÙNG một khoá: phiên đăng nhập, vé 2FA,
   * `state` của OAuth, challenge của passkey. Không phân loại thì một vé 2FA —
   * thứ chỉ chứng minh "vừa nhập đúng mật khẩu" — sẽ được nhận như một phiên
   * hoàn chỉnh, tức là bước thứ hai của 2FA bị bỏ qua hoàn toàn.
   *
   * Dùng DANH SÁCH TRẮNG, không phải danh sách đen: loại thêm sau này bị từ
   * chối theo mặc định.
   */
  typ: z.literal("access").default("access"),

  sub: z.string().min(1),
  email: z.email().nullable(),

  /**
   * KHOÁ của MỌI vai trò đang mang, ví dụ `["ADMIN", "STAFF"]`.
   *
   * Chuỗi tự do chứ không phải enum: vai trò nằm trong database và quản trị
   * viên tạo thêm được lúc chạy.
   *
   * Token KHÔNG mang danh sách quyền. Hai lý do: token sẽ phình theo số quyền,
   * và quan trọng hơn — quyền đã ký vào token thì sửa phân quyền không có tác
   * dụng cho tới khi token hết hạn. Quyền luôn tra lại qua `permissionService`.
   */
  roles: z.array(z.string()).default([]),

  /**
   * `familyId` của phiên — ĐỊNH DANH PHIÊN, không đổi qua các lần refresh.
   *
   * Dùng để đánh dấu "thiết bị này" trong danh sách phiên, và để đổi mật khẩu
   * biết phiên nào được giữ lại thay vì đăng xuất chính người đang thao tác.
   */
  sid: z.string().optional(),

  /** Thời điểm phiên vượt qua 2FA (ISO 8601). */
  mfa: z.string().optional(),

  /**
   * `iat` — thời điểm cấp, giây epoch. Do `jose` tự thêm.
   *
   * So với `User.passwordChangedAt` để thu hồi TỨC THÌ token cũ khi mật khẩu
   * đổi — JWT không thu hồi được, nên không có phép so này thì kẻ đã chiếm tài
   * khoản còn thao tác thêm tới hết hạn token.
   */
  iat: z.number().optional(),
});

export type SessionPayload = z.infer<typeof sessionPayloadSchema>;

/** Khoá vai trò. Xem ghi chú trong `sessionPayloadSchema`. */
export type UserRole = string;

/**
 * @param maxAgeSeconds Hạn token. Mặc định là hạn của cookie web; route handler
 * cho mobile truyền `ACCESS_TOKEN_MAX_AGE_SECONDS`.
 */
export async function signSession(
  payload: SessionPayload,
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS,
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);

  return new SignJWT({
    typ: "access",
    email: payload.email,
    roles: payload.roles,
    ...(payload.sid ? { sid: payload.sid } : {}),
    ...(payload.mfa ? { mfa: payload.mfa } : {}),
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(payload.sub)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + maxAgeSeconds)
    .sign(secretKey);
}

/** Trả về null cho mọi token hỏng, hết hạn, sai chữ ký hoặc sai cấu trúc. */
export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: [ALGORITHM],
    });

    // Chữ ký đúng không có nghĩa là cấu trúc đúng — vẫn phải validate.
    const parsed = sessionPayloadSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    // Chữ ký sai / hết hạn / rác. Không log ở đây: endpoint public bị dò sẽ
    // làm ngập log mà không mang thêm thông tin gì.
    return null;
  }
}

/** Tuỳ chọn cookie dùng chung cho cả lúc set và lúc xoá. */
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: isProduction,
  path: "/",
} as const;
