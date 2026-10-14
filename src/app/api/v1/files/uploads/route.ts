import { enforceRateLimit, requireApiPermission } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { permissionService } from "@/services/permission.service";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { createUploadSchema } from "@/schemas/file.schema";
import { fileService } from "@/services/file.service";

export const dynamic = "force-dynamic";

/**
 * Bước 1 của tải TRỰC TIẾP lên kho — cho video và tệp lớn, nội dung không chạy qua máy chủ.
 *
 *   1. `POST /api/v1/files/uploads` { fileName, contentType, size, kind } -> { file, upload }
 *   2. Client `PUT upload.url` với thân là nội dung tệp, kèm ĐÚNG `upload.headers`.
 *   3. `POST /api/v1/files/{file.id}/complete` -> máy chủ kiểm dung lượng + chữ ký trên kho.
 *
 * Chỉ dùng được khi kho là S3 (đĩa cục bộ ở dev trả 409).
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiPermission(request, "file:upload");
    await enforceRateLimit(request, "api:upload", RATE_LIMITS.upload);

    const body = await parseJsonBody(request, createUploadSchema);
    if (body.retain && !(await permissionService.can(session.sub, "file:manage"))) {
      throw apiErrors.forbidden("Chỉ người quản lý tệp mới giữ được tệp trong thư viện");
    }
    return apiOk(await fileService.createDirectUpload(body, session.sub), 201);
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/files/uploads", request });
  }
}
