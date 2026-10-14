import { enforceRateLimit, requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { verifyPhoneOtpSchema } from "@/schemas/auth.schema";
import { auditService } from "@/services/audit.service";
import { authService } from "@/services/auth.service";

export const dynamic = "force-dynamic";

/** Xác nhận OTP. Mã chỉ 6 chữ số nên rate limit ở đây là bắt buộc, không phải tuỳ chọn. */
export async function POST(request: Request) {
  try {
    const session = await requireApiUser(request);
    await enforceRateLimit(request, "api:phone-verify", RATE_LIMITS.phoneOtp);

    const body = await parseJsonBody(request, verifyPhoneOtpSchema);
    const user = await authService.confirmPhoneVerification(session.sub, body.code);

    await auditService.record({
      action: AUDIT_ACTIONS.PHONE_VERIFIED,
      entity: "user",
      entityId: session.sub,
      actorId: session.sub,
      actorEmail: session.email,
      userAgent: request.headers.get("user-agent"),
    });

    return apiOk({ user });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/phone/verify", request });
  }
}
