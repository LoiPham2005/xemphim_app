import { enforceRateLimit } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { confirmEmailChangeSchema } from "@/schemas/auth.schema";
import { auditService } from "@/services/audit.service";
import { authService } from "@/services/auth.service";

export const dynamic = "force-dynamic";

/**
 * Xác nhận đổi email bằng token trong link.
 *
 * CÔNG KHAI: người dùng bấm link từ hộp thư mới, có thể trên một trình duyệt
 * chưa đăng nhập. Token dùng-một-lần đã mang danh tính rồi.
 */
export async function POST(request: Request) {
  try {
    await enforceRateLimit(request, "api:confirm-email", RATE_LIMITS.emailVerificationRequest);

    const body = await parseJsonBody(request, confirmEmailChangeSchema);
    const user = await authService.confirmEmailChange(body.token);

    await auditService.record({
      action: AUDIT_ACTIONS.EMAIL_CHANGED,
      entity: "user",
      entityId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      userAgent: request.headers.get("user-agent"),
    });

    return apiOk({ user });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/change-email/confirm", request });
  }
}
