import { requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { notificationService } from "@/services/notification.service";

export const dynamic = "force-dynamic";

/** Con số cho chấm đỏ trên chuông. Tách riêng để không phải kéo cả danh sách. */
export async function GET(request: Request) {
  try {
    const session = await requireApiUser(request);

    return apiOk({ unreadCount: await notificationService.unreadCount(session.sub) });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/notifications/unread-count", request });
  }
}
