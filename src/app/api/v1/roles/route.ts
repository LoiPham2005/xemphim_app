import { requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { PERMISSIONS, PERMISSION_METADATA } from "@/lib/permissions";
import { createRoleSchema } from "@/schemas/role.schema";
import { roleService } from "@/services/role.service";

export const dynamic = "force-dynamic";

/**
 * Danh sách vai trò kèm bảng phân quyền.
 *
 * Trả kèm cả DANH MỤC quyền tồn tại (`permissions`), không chỉ những quyền đã
 * được gán. Giao diện phân quyền cần biết đầy đủ các ô tick có thể có; nếu chỉ
 * trả về quyền đã gán thì không có cách nào dựng được ô cho quyền chưa gán.
 *
 * Danh mục này đến từ code chứ không phải database — xem `src/lib/permissions.ts`.
 */
export async function GET(request: Request) {
  try {
    await requireApiPermission(request, "role:read");

    const roles = await roleService.list();

    return apiOk({
      roles,
      permissions: PERMISSIONS.map((key) => ({
        key,
        description: PERMISSION_METADATA[key],
      })),
    });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/roles", request });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission(request, "role:create");

    const body = await parseJsonBody(request, createRoleSchema);
    const role = await roleService.create(body, { actorId: session.sub });

    return apiOk({ role }, 201);
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/roles", request });
  }
}
