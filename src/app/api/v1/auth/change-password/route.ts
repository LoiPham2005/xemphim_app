import { enforceRateLimit, requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { changePasswordSchema } from "@/schemas/auth.schema";
import { authService } from "@/services/auth.service";

export const dynamic = "force-dynamic";

/**
 * Đổi mật khẩu khi đang đăng nhập.
 *
 * Vẫn bắt nhập mật khẩu hiện tại dù đã có session hợp lệ: nếu không, bất kỳ ai
 * ngồi vào máy đang mở sẵn phiên — hoặc chiếm được token — đều đổi được mật
 * khẩu và chiếm tài khoản vĩnh viễn.
 *
 * Thu hồi toàn bộ refresh token sau khi đổi, nên client phải đăng nhập lại.
 * Đó là hành vi mong muốn: đổi mật khẩu thường xuất phát từ nghi ngờ bị lộ.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiUser(request);

    await enforceRateLimit(request, "api:change-password", RATE_LIMITS.passwordChange);

    const body = await parseJsonBody(request, changePasswordSchema);
    await authService.changePassword(session.sub, body.currentPassword, body.newPassword);

    logger.info("API đổi mật khẩu", { userId: session.sub });

    return apiOk({ message: "Đổi mật khẩu thành công. Vui lòng đăng nhập lại." });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/change-password", request });
  }
}
