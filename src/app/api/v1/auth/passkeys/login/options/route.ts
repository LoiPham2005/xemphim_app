import { enforceRateLimit } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { issueWebAuthnTicket } from "@/lib/tickets";
import { webauthnService } from "@/services/webauthn.service";

export const dynamic = "force-dynamic";

/**
 * Bước 1 — tuỳ chọn cho `navigator.credentials.get()`.
 *
 * Cố ý KHÔNG nhận tham số nào. Trình duyệt tự hiện mọi passkey đã lưu cho tên
 * miền này, người dùng chọn một cái, xong. Bắt nhập email trước vừa thừa một
 * bước, vừa biến endpoint thành công cụ dò xem email nào đã đăng ký.
 */
export async function POST(request: Request) {
  try {
    await enforceRateLimit(request, "api:passkey", RATE_LIMITS.passkey);
    const options = await webauthnService.createAuthenticationOptions();

    return apiOk({
      options,
      // Vé không có `sub`: ở luồng này ta CHƯA biết người dùng là ai, và đó là
      // điểm mạnh — danh tính đến từ chính passkey được chọn.
      challengeToken: await issueWebAuthnTicket("webauthn_auth", options.challenge),
    });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/passkeys/login/options", request });
  }
}
