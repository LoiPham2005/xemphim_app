import { enforceRateLimit } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { verifyEmailSchema } from "@/schemas/auth.schema";
import { authService } from "@/services/auth.service";

export const dynamic = "force-dynamic";

/**
 * Xác thực địa chỉ email bằng token trong link.
 *
 * Không yêu cầu đăng nhập có chủ đích: người dùng thường mở link từ hộp thư
 * trên một thiết bị khác với thiết bị đã đăng ký. Bản thân token đã là bằng
 * chứng họ kiểm soát được hộp thư đó — đúng thứ đang cần chứng minh.
 */
export async function POST(request: Request) {
  try {
    await enforceRateLimit(request, "api:verify-email", RATE_LIMITS.passwordChange);

    const body = await parseJsonBody(request, verifyEmailSchema);
    const user = await authService.verifyEmail(body.token);

    logger.info("API verify email", { userId: user.id });

    return apiOk({ user });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/verify-email", request });
  }
}
