import { enforceRateLimit } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { resetPasswordSchema } from "@/schemas/auth.schema";
import { authService } from "@/services/auth.service";

export const dynamic = "force-dynamic";

/**
 * Đặt mật khẩu mới bằng token trong email.
 *
 * Sau khi đổi, toàn bộ refresh token của tài khoản bị thu hồi (xem
 * `AuthService.resetPassword`). Client phải coi mọi token đang giữ là đã hỏng
 * và điều hướng người dùng về màn hình đăng nhập.
 */
export async function POST(request: Request) {
  try {
    await enforceRateLimit(request, "api:reset-password", RATE_LIMITS.passwordChange);

    const body = await parseJsonBody(request, resetPasswordSchema);
    await authService.resetPassword(body.token, body.password);

    logger.info("API reset password thành công");

    return apiOk({
      message: "Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.",
    });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/reset-password", request });
  }
}
