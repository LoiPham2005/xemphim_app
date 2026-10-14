import { clientIp, enforceRateLimit, requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { disableTwoFactorSchema } from "@/schemas/auth.schema";
import { auditService } from "@/services/audit.service";
import { twoFactorService } from "@/services/two-factor.service";

export const dynamic = "force-dynamic";

/**
 * Bật/tắt xác thực hai lớp cho tài khoản ĐANG ĐĂNG NHẬP.
 *
 * Phần xác minh mã lúc ĐĂNG NHẬP nằm ở `POST /auth/2fa/verify` vì lúc đó người
 * dùng chưa có access token — họ mới có vé.
 *
 * ---
 * LUỒNG BẬT: BA BƯỚC, KHÔNG PHẢI MỘT
 *
 *   1. `POST /auth/2fa/setup`  → trả `secret` + `uri` để dựng QR. CHƯA bật.
 *   2. Người dùng quét QR bằng app xác thực.
 *   3. `POST /auth/2fa/enable` → mã đúng thì mới bật, và trả mã khôi phục.
 *
 * Bước 3 không phải thủ tục thừa: nó chứng minh app xác thực ĐÃ lưu đúng bí
 * mật. Bật ngay từ bước 1 thì người quét QR hỏng sẽ bị khoá vĩnh viễn khỏi tài
 * khoản của chính mình.
 */
export async function GET(request: Request) {
  try {
    const session = await requireApiUser(request);
    const status = await twoFactorService.status(session.sub);

    // `available` cho giao diện biết có nên hiện nút "Bật 2FA" hay không. Hiện
    // một nút mà bấm vào chỉ ra lỗi cấu hình máy chủ thì tệ hơn là ẩn nó đi.
    return apiOk({ ...status, available: twoFactorService.isAvailable() });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/auth/2fa", request });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireApiUser(request);
    await enforceRateLimit(request, "api:2fa", RATE_LIMITS.twoFactor);

    const body = await parseJsonBody(request, disableTwoFactorSchema);
    await twoFactorService.disable(session.sub, body.password ?? null, body.code);

    // Tắt 2FA là hành động HẠ mức bảo vệ của tài khoản — phải nằm trong nhật ký
    // để sau này còn trả lời được "ai tắt, lúc nào".
    await auditService.record({
      action: AUDIT_ACTIONS.TWO_FACTOR_DISABLED,
      entity: "user",
      entityId: session.sub,
      actorId: session.sub,
      actorEmail: session.email,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    return apiOk({ twoFactorEnabled: false });
  } catch (error) {
    return handleApiError(error, { route: "DELETE /api/v1/auth/2fa", request });
  }
}
