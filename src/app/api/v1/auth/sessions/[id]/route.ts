import { requireApiUser } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { tokenService } from "@/services/token.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Đăng xuất MỘT thiết bị — nút "đăng xuất khỏi thiết bị này".
 *
 * ---
 * ⚠️ RÀNG BUỘC QUYỀN SỞ HỮU NẰM TRONG CÂU TRUY VẤN
 *
 * `id` đến từ URL, tức là do người gọi tuỳ ý đặt. Nếu chỉ `revokeById(id)` rồi
 * tin rằng id đó thuộc về người đang đăng nhập, thì bất kỳ ai cũng đăng xuất
 * được thiết bị của người khác chỉ bằng cách thử id.
 *
 * Vì vậy `session.sub` được truyền xuống service và nằm trong `where`, không
 * phải một phép kiểm tra riêng phía trên — kiểm tra riêng thì có ngày ai đó
 * thêm một đường gọi mới mà quên mất nó.
 *
 * ---
 * KHÔNG PHÂN BIỆT "KHÔNG TỒN TẠI" VỚI "CỦA NGƯỜI KHÁC"
 *
 * Cả hai đều trả 404. Trả 403 cho trường hợp thứ hai là xác nhận cho người
 * hỏi biết id đó có thật và thuộc về ai đó — đủ để dò.
 */
export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiUser(request);

    const revoked = await tokenService.revokeById(id, session.sub);

    if (!revoked) {
      throw apiErrors.notFound("Không tìm thấy phiên đăng nhập");
    }

    logger.info("Thu hồi một phiên đăng nhập", { userId: session.sub, sessionId: id });

    return apiOk({ id });
  } catch (error) {
    return handleApiError(error, { route: "DELETE /api/v1/auth/sessions/[id]", request });
  }
}
