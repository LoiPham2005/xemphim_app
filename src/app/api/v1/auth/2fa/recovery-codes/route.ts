import { clientIp, enforceRateLimit, requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { confirmTwoFactorSchema } from "@/schemas/auth.schema";
import { auditService } from "@/services/audit.service";
import { twoFactorService } from "@/services/two-factor.service";

export const dynamic = "force-dynamic";

/** Cấp lại bộ mã khôi phục — mã cũ mất hiệu lực ngay lập tức. */
export async function POST(request: Request) {
  try {
    const session = await requireApiUser(request);
    await enforceRateLimit(request, "api:2fa", RATE_LIMITS.twoFactor);

    const body = await parseJsonBody(request, confirmTwoFactorSchema);
    const recoveryCodes = await twoFactorService.regenerateRecoveryCodes(session.sub, body.code);

    await auditService.record({
      action: AUDIT_ACTIONS.TWO_FACTOR_RECOVERY_REGENERATED,
      entity: "user",
      entityId: session.sub,
      actorId: session.sub,
      actorEmail: session.email,
      ip: clientIp(request),
    });

    return apiOk({ recoveryCodes });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/2fa/recovery-codes", request });
  }
}
