import { clientIp, requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { renamePasskeySchema } from "@/schemas/auth.schema";
import { auditService } from "@/services/audit.service";
import { webauthnService } from "@/services/webauthn.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Ràng buộc quyền sở hữu nằm TRONG câu truy vấn của service (`where: { id,
 * userId }`), không phải một phép kiểm tra riêng ở đây — `id` đến từ URL nên
 * người gọi tự đặt được.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiUser(request);
    const body = await parseJsonBody(request, renamePasskeySchema);

    return apiOk({ passkey: await webauthnService.rename(id, session.sub, body.name) });
  } catch (error) {
    return handleApiError(error, { route: "PATCH /api/v1/auth/passkeys/[id]", request });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiUser(request);

    // Service từ chối nếu đây là cách đăng nhập CUỐI CÙNG của tài khoản — xoá
    // được thì người dùng tự khoá mình ra ngoài vĩnh viễn.
    await webauthnService.remove(id, session.sub);

    await auditService.record({
      action: AUDIT_ACTIONS.PASSKEY_REMOVED,
      entity: "webauthn_credential",
      entityId: id,
      actorId: session.sub,
      actorEmail: session.email,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    return apiOk({ id });
  } catch (error) {
    return handleApiError(error, { route: "DELETE /api/v1/auth/passkeys/[id]", request });
  }
}
