import { enforceRateLimit } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { forgotPasswordSchema } from "@/schemas/auth.schema";
import { authService } from "@/services/auth.service";

export const dynamic = "force-dynamic";

/**
 * Yêu cầu link đặt lại mật khẩu.
 *
 * ---
 * VÌ SAO LUÔN TRẢ VỀ THÀNH CÔNG
 *
 * Endpoint này công khai. Nếu email chưa đăng ký mà trả 404, thì bất kỳ ai
 * cũng dò được danh sách người dùng của hệ thống chỉ bằng cách thử từng địa
 * chỉ. Với các hệ thống nhạy cảm — y tế, tài chính, hẹn hò — chỉ riêng việc
 * xác nhận "người này có tài khoản" đã là rò rỉ dữ liệu.
 *
 * Nên: cùng một phản hồi cho mọi trường hợp.
 *
 * Kể cả LỖI THẬT cũng bị nuốt ở đây. Nghe phản trực giác, nhưng nếu để lỗi
 * bung ra thành 500 thì chính mã lỗi đó là tín hiệu — 500 chỉ xảy ra khi có
 * user thật và bước gửi thư thất bại, còn email không tồn tại thì luôn trả 200.
 * Lỗi vẫn được ghi vào log để bạn biết mà xử lý.
 */
export async function POST(request: Request) {
  try {
    await enforceRateLimit(request, "api:forgot-password", RATE_LIMITS.passwordResetRequest);

    const body = await parseJsonBody(request, forgotPasswordSchema);

    try {
      await authService.requestPasswordReset(body.email);
    } catch (error) {
      logger.error("Không gửi được email đặt lại mật khẩu", error);
    }

    return apiOk({
      message: "Nếu địa chỉ này có tài khoản, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu.",
    });
  } catch (error) {
    // Chỉ còn lỗi rate limit và lỗi validate lọt tới đây — cả hai đều không
    // tiết lộ email có tồn tại hay không.
    return handleApiError(error, { route: "POST /api/v1/auth/forgot-password", request });
  }
}
