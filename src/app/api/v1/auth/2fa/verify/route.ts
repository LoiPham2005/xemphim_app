import { clientIp, enforceRateLimit } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { issueTokenPair } from "@/lib/api/tokens";
import { InvalidTwoFactorCodeError } from "@/lib/errors";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { verifyTicket } from "@/lib/tickets";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { verifyTwoFactorSchema } from "@/schemas/auth.schema";
import { auditService } from "@/services/audit.service";
import { authService } from "@/services/auth.service";
import { twoFactorService } from "@/services/two-factor.service";

export const dynamic = "force-dynamic";

/**
 * Bước 2 của đăng nhập: đổi vé 2FA + mã lấy token thật.
 *
 * Endpoint này CÔNG KHAI (không cần access token) — người gọi chưa có phiên,
 * họ mới chỉ có vé. Vé mang `typ: "2fa"` nên không dùng thay access token được,
 * và access token cũng không dùng thay vé được.
 */
export async function POST(request: Request) {
  try {
    await enforceRateLimit(request, "api:2fa", RATE_LIMITS.twoFactor);

    const body = await parseJsonBody(request, verifyTwoFactorSchema);
    const ticket = await verifyTicket(body.challengeToken, "2fa");

    if (!ticket) {
      throw apiErrors.unauthenticated("Vé xác thực không hợp lệ hoặc đã hết hạn");
    }

    const userAgent = request.headers.get("user-agent");
    const ip = clientIp(request);

    if (!(await twoFactorService.verifyCode(ticket.sub, body.code))) {
      await auditService.record({
        action: AUDIT_ACTIONS.TWO_FACTOR_FAILED,
        entity: "user",
        entityId: ticket.sub,
        actorId: ticket.sub,
        ip,
        userAgent,
      });

      throw new InvalidTwoFactorCodeError();
    }

    // Kiểm lại trạng thái tài khoản: nó có thể vừa bị khoá trong vài giây giữa
    // bước nhập mật khẩu và bước nhập mã.
    const user = await authService.completeTwoFactorLogin(ticket.sub);

    const tokens = await issueTokenPair(user, { userAgent, ip, twoFactorAt: new Date() });

    await auditService.record({
      action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
      entity: "user",
      entityId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      metadata: { method: "2fa" },
      ip,
      userAgent,
    });

    return apiOk({ user, ...tokens });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/2fa/verify", request });
  }
}
