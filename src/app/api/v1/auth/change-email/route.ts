import { enforceRateLimit, requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { requestEmailChangeSchema } from "@/schemas/auth.schema";
import { auditService } from "@/services/audit.service";
import { authService } from "@/services/auth.service";

export const dynamic = "force-dynamic";

/**
 * Xin đổi email — gửi link xác nhận tới địa chỉ MỚI.
 *
 * Email chỉ đổi thật khi link được bấm (`POST /auth/change-email/confirm`).
 * Đổi ngay tại đây thì gõ nhầm một ký tự là mất luôn đường đăng nhập và đường
 * khôi phục mật khẩu — địa chỉ mới không tồn tại, mà địa chỉ cũ đã bị ghi đè.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiUser(request);
    await enforceRateLimit(request, "api:change-email", RATE_LIMITS.emailVerificationRequest);

    const body = await parseJsonBody(request, requestEmailChangeSchema);
    await authService.requestEmailChange(session.sub, body.newEmail, body.password);

    await auditService.record({
      action: AUDIT_ACTIONS.EMAIL_CHANGE_REQUESTED,
      entity: "user",
      entityId: session.sub,
      actorId: session.sub,
      actorEmail: session.email,
      userAgent: request.headers.get("user-agent"),
    });

    return apiOk({ pendingEmail: body.newEmail });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/change-email", request });
  }
}
