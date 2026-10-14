import { clientIp, enforceRateLimit, requireApiUser } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { verifyTicket } from "@/lib/tickets";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { registerPasskeySchema } from "@/schemas/auth.schema";
import { auditService } from "@/services/audit.service";
import { webauthnService } from "@/services/webauthn.service";

export const dynamic = "force-dynamic";

/** Bước 2 — xác minh và lưu passkey. */
export async function POST(request: Request) {
  try {
    const session = await requireApiUser(request);
    await enforceRateLimit(request, "api:passkey", RATE_LIMITS.passkey);

    const body = await parseJsonBody(request, registerPasskeySchema);
    const ticket = await verifyTicket(body.challengeToken, "webauthn_reg");

    if (!ticket) {
      throw apiErrors.unauthenticated("Phiên đăng ký passkey đã hết hạn. Vui lòng thử lại.");
    }

    // Vé mang `sub` của người đã xin nó. Không đối chiếu thì A xin vé rồi đưa
    // cho B dùng, và passkey của B được gắn vào tài khoản A.
    if (ticket.sub !== session.sub) {
      throw apiErrors.unauthenticated("Vé đăng ký passkey không thuộc về tài khoản này");
    }

    const passkey = await webauthnService.verifyRegistration(
      session.sub,
      body.response,
      ticket.challenge,
      body.name,
    );

    await auditService.record({
      action: AUDIT_ACTIONS.PASSKEY_REGISTERED,
      entity: "webauthn_credential",
      entityId: passkey.id,
      actorId: session.sub,
      actorEmail: session.email,
      metadata: { deviceType: passkey.deviceType, backedUp: passkey.backedUp },
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    return apiOk({ passkey }, 201);
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/passkeys/register/verify", request });
  }
}
