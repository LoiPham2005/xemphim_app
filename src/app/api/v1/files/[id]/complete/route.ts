import { requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { fileService } from "@/services/file.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Bước 3 của tải trực tiếp: client báo đã `PUT` xong. Máy chủ kiểm tệp THẬT trên kho (tồn tại, dung
 * lượng trong luật, chữ ký đầu tệp khớp định dạng) rồi mới chuyển sang dùng được. Không đạt thì xoá
 * luôn và trả 422.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiPermission(request, "file:upload");
    const file = await fileService.completeDirectUpload(id, {
      userId: session.sub,
      canManage: false,
    });
    return apiOk({ file });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/files/[id]/complete", request });
  }
}
