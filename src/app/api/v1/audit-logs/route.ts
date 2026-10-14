import { requireApiPermission } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError } from "@/lib/api/response";
import { listAuditLogsSchema } from "@/schemas/audit.schema";
import { auditService } from "@/services/audit.service";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * Nhật ký thao tác. Chỉ ĐỌC — không có đường ghi từ HTTP, và cũng không có
 * đường sửa hay xoá: một nhật ký chỉnh sửa được thì không còn là bằng chứng.
 */
export async function GET(request: Request) {
  try {
    await requireApiPermission(request, "audit:read");

    const url = new URL(request.url);
    const parsed = listAuditLogsSchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) throw apiErrors.validation(z.flattenError(parsed.error).fieldErrors);

    return apiOk(await auditService.list(parsed.data));
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/audit-logs", request });
  }
}
