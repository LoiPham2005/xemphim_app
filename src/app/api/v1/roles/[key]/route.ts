import { requireApiPermission } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { updateRoleSchema } from "@/schemas/role.schema";
import { roleService } from "@/services/role.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ key: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { key } = await params;
    await requireApiPermission(request, "role:read");

    const role = await roleService.findByKey(key);
    if (!role) throw apiErrors.notFound("Không tìm thấy vai trò");

    return apiOk({ role });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/roles/[key]", request });
  }
}

/**
 * Đổi tên/mô tả và/hoặc thay toàn bộ danh sách quyền của vai trò.
 *
 * `permissions` mang ngữ nghĩa THAY THẾ TOÀN BỘ, không phải thêm vào — đó là
 * thứ giao diện tick-chọn cần, vì bỏ tick phải thực sự gỡ được quyền.
 *
 * ⚠️ Đây là endpoint nguy hiểm nhất của hệ thống: ai gọi được nó thì tự cấp
 * cho mình mọi quyền còn lại bằng vài request. Vì vậy nó đứng sau quyền
 * `role:update` riêng, không dùng chung với `user:update`.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { key } = await params;
    const session = await requireApiPermission(request, "role:update");

    const body = await parseJsonBody(request, updateRoleSchema);
    const role = await roleService.update(key, body, { actorId: session.sub });

    return apiOk({ role });
  } catch (error) {
    return handleApiError(error, { route: "PATCH /api/v1/roles/[key]", request });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { key } = await params;
    const session = await requireApiPermission(request, "role:delete");

    // Luật "không xoá vai trò hệ thống" và "không xoá vai trò còn người dùng"
    // do service giữ; handleApiError đổi chúng thành 409.
    await roleService.remove(key, { actorId: session.sub });

    return apiOk({ key });
  } catch (error) {
    return handleApiError(error, { route: "DELETE /api/v1/roles/[key]", request });
  }
}
