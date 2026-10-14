import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { env } from "./env";

/**
 * Vé ngắn hạn — JWT KHÔNG phải phiên đăng nhập.
 *
 * ---
 * VÌ SAO PHẢI TÁCH KHỎI `session.ts`
 *
 * Hệ thống ký nhiều loại token bằng CÙNG một khoá `SESSION_SECRET`: phiên đăng
 * nhập, vé 2FA, challenge của passkey. Chữ ký đúng vì thế KHÔNG chứng minh
 * được token dùng vào việc gì.
 *
 * `verifySession()` chỉ chấp nhận `typ: "access"`, còn `verifyTicket()` chỉ
 * chấp nhận đúng loại vé được yêu cầu. Hai chiều chặn nhau: cầm vé 2FA không
 * gọi được API nào, và cầm access token không hoàn tất được bước 2FA.
 *
 * Thiếu phép kiểm đó thì vé 2FA — thứ chỉ chứng minh "vừa nhập đúng mật khẩu"
 * — được nhận như một phiên hoàn chỉnh, tức là lớp thứ hai bị bỏ qua sạch.
 *
 * ---
 * VÌ SAO KHÔNG LƯU CHALLENGE VÀO DATABASE
 *
 * Challenge của WebAuthn phải được đối chiếu ở bước xác minh, nếu không một
 * phản hồi cũ phát lại được. Ký nó vào một vé có hạn thì không cần bảng lưu,
 * không cần job dọn dẹp, và không có trạng thái nào để đồng bộ giữa nhiều
 * tiến trình web.
 */

const ALGORITHM = "HS256";
const secretKey = new TextEncoder().encode(env.SESSION_SECRET);

/**
 * Hạn vé WebAuthn.
 *
 * Trùng `timeout` mặc định của `@simplewebauthn/server` (60 giây), cộng dư cho
 * người dùng lóng ngóng tìm khoá cứng. Để lâu hơn là kéo dài cửa sổ phát lại.
 */
const WEBAUTHN_TTL_SECONDS = 5 * 60;

const ticketSchema = z.discriminatedUnion("typ", [
  z.object({ typ: z.literal("2fa"), sub: z.string().min(1) }),
  z.object({
    typ: z.literal("webauthn_reg"),
    challenge: z.string().min(1),
    sub: z.string().min(1),
  }),
  // Luồng đăng nhập KHÔNG có `sub`: ở bước này chưa biết người dùng là ai, và
  // đó là điểm mạnh — danh tính đến từ chính passkey được chọn.
  z.object({ typ: z.literal("webauthn_auth"), challenge: z.string().min(1) }),
]);

export type Ticket = z.infer<typeof ticketSchema>;
export type TicketType = Ticket["typ"];

async function sign(payload: Ticket, ttlSeconds: number): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);

  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ttlSeconds)
    .sign(secretKey);
}

/**
 * Vé cấp sau khi mật khẩu đã đúng nhưng tài khoản có bật 2FA.
 *
 * Hạn rất ngắn (mặc định 5 phút): vé chứng minh "vừa nhập đúng mật khẩu", để
 * lâu là kéo dài cửa sổ mà một máy bị chiếm có thể hoàn tất đăng nhập.
 */
export async function issueTwoFactorTicket(userId: string) {
  const expiresIn = env.TWO_FACTOR_CHALLENGE_TTL_MINUTES * 60;

  return {
    twoFactorRequired: true as const,
    challengeToken: await sign({ typ: "2fa", sub: userId }, expiresIn),
    expiresIn,
  };
}

export async function issueWebAuthnTicket(
  typ: "webauthn_reg" | "webauthn_auth",
  challenge: string,
  userId?: string,
): Promise<string> {
  const payload: Ticket =
    typ === "webauthn_reg"
      ? { typ, challenge, sub: userId ?? "" }
      : { typ: "webauthn_auth", challenge };

  return sign(payload, WEBAUTHN_TTL_SECONDS);
}

/**
 * Đọc vé. Trả `null` cho vé hỏng, hết hạn, sai chữ ký HOẶC sai loại.
 *
 * Sai loại cũng trả `null` như hỏng: phân biệt hai ca đó chỉ giúp người đang
 * dò biết mình đoán đúng nửa đường.
 */
export async function verifyTicket<T extends TicketType>(
  token: string | undefined,
  expectedType: T,
): Promise<Extract<Ticket, { typ: T }> | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: [ALGORITHM] });
    const parsed = ticketSchema.safeParse(payload);

    if (!parsed.success || parsed.data.typ !== expectedType) return null;

    return parsed.data as Extract<Ticket, { typ: T }>;
  } catch {
    return null;
  }
}
