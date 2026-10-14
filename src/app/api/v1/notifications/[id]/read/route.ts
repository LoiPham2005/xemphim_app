import { requireApiUser } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError } from "@/lib/api/response";
import { notificationService } from "@/services/notification.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Đánh dấu ĐÃ ĐỌC một thông báo.
 *
 * `id` là id bản ghi NGƯỜI NHẬN, không phải id thông báo: một thông báo
 * broadcast có nhiều người nhận, và mỗi người đọc riêng. Ràng buộc quyền sở
 * hữu nằm trong câu truy vấn của service.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiUser(request);

    // Trả 404 cho cả "không tồn tại" lẫn "của người khác" — phân biệt hai ca
    // đó là xác nhận id có thật.
    if (!(await notificationService.markRead(id, session.sub))) {
      throw apiErrors.notFound("Không tìm thấy thông báo");
    }

    return apiOk({ id });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/notifications/[id]/read", request });
  }
}
