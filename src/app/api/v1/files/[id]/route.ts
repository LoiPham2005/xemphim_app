import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { renameFileSchema } from "@/schemas/file.schema";
import { fileService } from "@/services/file.service";
import { requireFileViewer } from "../viewer";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Chi tiết một tệp. Không phải của mình (và không có `file:manage`) thì 404 — không lộ tệp có tồn tại. */
export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const viewer = await requireFileViewer(request);
    return apiOk({ file: await fileService.get(id, viewer) });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/files/[id]", request });
  }
}

/** Đổi TÊN hiển thị. Nội dung tệp không sửa được — tải tệp mới rồi gắn lại. */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const viewer = await requireFileViewer(request);
    const body = await parseJsonBody(request, renameFileSchema);
    return apiOk({ file: await fileService.rename(id, body, viewer) });
  } catch (error) {
    return handleApiError(error, { route: "PATCH /api/v1/files/[id]", request });
  }
}

/** Xoá tệp khỏi kho. Tệp đang được dùng (vd. làm avatar) thì 409 — gỡ ra trước. */
export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const viewer = await requireFileViewer(request);
    await fileService.remove(id, viewer);
    return apiOk({ id });
  } catch (error) {
    return handleApiError(error, { route: "DELETE /api/v1/files/[id]", request });
  }
}
