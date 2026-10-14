import { enforceRateLimit, clientIp } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { issueTokenPair } from "@/lib/api/tokens";
import { TwoFactorRequiredError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { RATE_LIMITS, resetRateLimit } from "@/lib/rate-limit";
import { issueTwoFactorTicket } from "@/lib/tickets";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { loginSchema } from "@/schemas/auth.schema";
import { auditService } from "@/services/audit.service";
import { authService } from "@/services/auth.service";

export const dynamic = "force-dynamic";

/**
 * Đăng nhập — trả về token, HOẶC một vé 2FA nếu tài khoản đã bật.
 *
 * Hai hình dạng response KHÁC HẲN nhau có chủ đích: client buộc phải rẽ nhánh
 * tường minh, thay vì đọc phải một object thiếu `accessToken` rồi hỏng ở đâu
 * đó xa hơn.
 */
export async function POST(request: Request) {
  try {
    const rateLimitKey = await enforceRateLimit(request, "api:login", RATE_LIMITS.login);

    const body = await parseJsonBody(request, loginSchema);
    const userAgent = request.headers.get("user-agent");
    const ip = clientIp(request);

    let user;
    try {
      user = await authService.validateCredentials(body);
    } catch (error) {
      /*
       * KHÔNG phải lỗi — đây là một bước trong luồng đăng nhập.
       *
       * `validateCredentials` ném thay vì trả cờ để nơi gọi không thể vô tình
       * bỏ qua bước thứ hai; bắt lại ở đây là chỗ duy nhất biết phải làm gì
       * tiếp. Mật khẩu ĐÃ đúng tại thời điểm này, nhưng chưa cấp token nào.
       */
      if (error instanceof TwoFactorRequiredError) {
        // Không reset rate limit: chưa đăng nhập xong.
        return apiOk(await issueTwoFactorTicket(error.userId));
      }
      throw error;
    }

    await resetRateLimit(rateLimitKey);
    logger.info("API login", { userId: user.id });

    const tokens = await issueTokenPair(user, { userAgent, ip });

    await auditService.record({
      action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
      entity: "user",
      entityId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      ip,
      userAgent,
    });

    return apiOk({ user, ...tokens });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/login", request });
  }
}
