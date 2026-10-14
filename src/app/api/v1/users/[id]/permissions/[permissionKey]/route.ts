import { requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { permissionService } from "@/services/permission.service";
import { userService } from "@/services/user.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; permissionKey: string }> };

/** Gỡ ngoại lệ, trả người dùng về đúng quyền của vai trò họ đang mang. */
export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { id, permissionKey } = await params;
    await requireApiPermission(request, "user:update");

    await userService.clearUserPermission(id, decodeURIComponent(permissionKey));

    return apiOk({ permissions: await permissionService.explainFor(id) });
  } catch (error) {
    return handleApiError(error, {
      route: "DELETE /api/v1/users/[id]/permissions/[permissionKey]",
      request,
    });
  }
}
