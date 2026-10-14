import { requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { assignRolesSchema } from "@/schemas/user.schema";
import { auditService } from "@/services/audit.service";
import { userService } from "@/services/user.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * THAY TOÀN BỘ danh sách vai trò của một người (PUT, không phải PATCH).
 *
 * Gửi thiếu là GỠ mất — cố ý: "thêm một vai trò" và "đặt lại danh sách" là hai
 * ý định khác nhau, và một endpoint chỉ nên làm đúng một trong hai. Luật cấm
 * leo thang (`Role.level`) nằm trong service, không nằm đây.
 */
export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiPermission(request, "user:update");
    const body = await parseJsonBody(request, assignRolesSchema);

    const user = await userService.update(
      id,
      { roleKeys: body.roleKeys },
      { actorId: session.sub },
    );

    await auditService.record({
      action: AUDIT_ACTIONS.USER_ROLES_ASSIGNED,
      entity: "user",
      entityId: id,
      actorId: session.sub,
      actorEmail: session.email,
      metadata: { roleKeys: body.roleKeys },
      userAgent: request.headers.get("user-agent"),
    });

    return apiOk({ user });
  } catch (error) {
    return handleApiError(error, { route: "PUT /api/v1/users/[id]/roles", request });
  }
}
