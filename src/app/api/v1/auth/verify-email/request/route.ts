import { enforceRateLimit, requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { authService } from "@/services/auth.service";

export const dynamic = "force-dynamic";

/**
 * Gửi lại email xác thực cho tài khoản đang đăng nhập.
 *
 * Địa chỉ nhận lấy từ session, KHÔNG lấy từ body. Cho phép chỉ định địa chỉ
 * nhận là biến endpoint này thành công cụ dội thư rác tới bất kỳ ai.
 *
 * Trả về cùng một thông điệp kể cả khi email đã xác thực rồi — không có lý do
 * gì để tiết lộ thêm, và client cũng không cần xử lý khác đi.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiUser(request);

    await enforceRateLimit(
      request,
      "api:verify-email-request",
      RATE_LIMITS.emailVerificationRequest,
    );

    await authService.sendEmailVerification(session.sub);

    logger.info("API gửi lại email xác thực", { userId: session.sub });

    return apiOk({ message: "Đã gửi email xác thực nếu địa chỉ chưa được xác thực." });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/verify-email/request", request });
  }
}
