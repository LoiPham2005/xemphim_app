import { requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { PERMISSION_METADATA, PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Danh mục quyền TỒN TẠI trong hệ thống.
 *
 * Đến từ CODE (`src/lib/permissions.ts`), không phải database: danh mục là thứ
 * mã nguồn tham chiếu tới, nên nó phải do mã nguồn định nghĩa. Database chỉ
 * giữ việc GÁN quyền cho vai trò — thứ sửa được lúc chạy.
 *
 * Màn phân quyền cần endpoint này để biết có những ô nào để tick.
 */
export function GET(request: Request) {
  return requireApiPermission(request, "role:read")
    .then(() =>
      apiOk({
        permissions: PERMISSIONS.map((key) => ({ key, ...PERMISSION_METADATA[key] })),
      }),
    )
    .catch((error: unknown) =>
      handleApiError(error, { route: "GET /api/v1/permissions", request }),
    );
}
