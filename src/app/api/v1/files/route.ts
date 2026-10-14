import { z } from "zod";
import { enforceRateLimit, requireApiPermission } from "@/lib/api/auth";
import { permissionService } from "@/services/permission.service";
import { apiErrors, apiOk, handleApiError } from "@/lib/api/response";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { listFilesSchema } from "@/schemas/file.schema";
import { fileService } from "@/services/file.service";
import { requireFileViewer } from "./viewer";

export const dynamic = "force-dynamic";

/** Danh sách tệp — người thường chỉ thấy tệp của mình, `file:manage` thấy tất cả. */
export async function GET(request: Request) {
  try {
    const viewer = await requireFileViewer(request);

    const url = new URL(request.url);
    const parsed = listFilesSchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      throw apiErrors.validation(z.flattenError(parsed.error).fieldErrors);
    }

    const { items, meta } = await fileService.list(parsed.data, viewer);
    return apiOk({ items, meta });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/files", request });
  }
}

/**
 * Tải tệp lên QUA MÁY CHỦ (multipart: `file`, `folder`) — ảnh, tài liệu, âm thanh. Nhóm tệp
 * suy ra từ Content-Type của phần `file`, client không gửi `kind`.
 * Video và tệp lớn đi `POST /api/v1/files/uploads` (tải thẳng lên kho).
 *
 * ---
 * VÌ SAO KIỂM MAGIC BYTES CHỨ KHÔNG TIN `file.type`
 *
 * `Content-Type` trong multipart do CLIENT khai. Một tệp `.html` khai là
 * `image/png` sẽ qua mọi phép kiểm dựa trên chuỗi đó — và nếu kho lưu trữ phục
 * vụ file công khai, tên miền của bạn vừa thành nơi chứa trang lừa đảo.
 *
 * `assertUploadAllowed` đọc vài byte đầu của DỮ LIỆU THẬT — danh sách trắng cho mọi định dạng.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiPermission(request, "file:upload");
    await enforceRateLimit(request, "api:upload", RATE_LIMITS.upload);

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");

    if (!(file instanceof File)) {
      throw apiErrors.validation({ file: ["Thiếu tệp trong trường `file`"] });
    }

    const folderValue = form?.get("folder");

    // `retain` = giữ trong thư viện, không bị dọn — chỉ người quản lý tệp. Người thường mà bật được thì
    // tải tệp không gắn vào đâu mà vẫn nằm mãi trên kho.
    const retained = form?.get("retain") === "true";
    if (retained && !(await permissionService.can(session.sub, "file:manage"))) {
      throw apiErrors.forbidden("Chỉ người quản lý tệp mới giữ được tệp trong thư viện");
    }

    // Đọc TOÀN BỘ vào bộ nhớ: đó là cái giá của việc kiểm được nội dung thật. Luật mỗi nhóm giới hạn
    // dung lượng (tối đa 50MB), video bị chặn ở đây và phải đi đường tải trực tiếp.
    const saved = await fileService.upload(
      {
        data: Buffer.from(await file.arrayBuffer()),
        originalName: file.name,
        contentType: file.type,
        folder: typeof folderValue === "string" ? folderValue : undefined,
        retained,
      },
      session.sub,
    );

    // Tệp lúc này MỒ CÔI: client gửi `file.id` kèm form nghiệp vụ (vd. `avatarFileId` ở
    // `PATCH /users/{id}`) để gắn. Không gắn trong 24 giờ thì `pnpm db:purge` dọn đi.
    return apiOk({ file: saved }, 201);
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/files", request });
  }
}
