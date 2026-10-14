import { clientIp, enforceRateLimit, requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { confirmTwoFactorSchema } from "@/schemas/auth.schema";
import { auditService } from "@/services/audit.service";
import { twoFactorService } from "@/services/two-factor.service";

export const dynamic = "force-dynamic";

/**
 * Bước 3 — xác nhận mã và bật 2FA thật.
 *
 * Có rate limit: mã TOTP chỉ 6 chữ số, và endpoint này chấp nhận thử liên tục
 * nếu không chặn.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiUser(request);
    await enforceRateLimit(request, "api:2fa", RATE_LIMITS.twoFactor);

    const body = await parseJsonBody(request, confirmTwoFactorSchema);
    const recoveryCodes = await twoFactorService.confirmSetup(session.sub, body.code);

    await auditService.record({
      action: AUDIT_ACTIONS.TWO_FACTOR_ENABLED,
      entity: "user",
      entityId: session.sub,
      actorId: session.sub,
      actorEmail: session.email,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    // ⚠️ ĐÂY LÀ LẦN DUY NHẤT mã khôi phục tồn tại ở dạng đọc được. Giao diện
    // phải hiển thị ngay và bắt người dùng xác nhận đã lưu.
    return apiOk({ recoveryCodes });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/2fa/enable", request });
  }
}
