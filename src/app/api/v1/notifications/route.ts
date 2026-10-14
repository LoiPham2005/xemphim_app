import { requireApiPermission, requireApiUser } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { listNotificationsSchema, sendNotificationSchema } from "@/schemas/notification.schema";
import { notificationService } from "@/services/notification.service";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * Hộp thư của CHÍNH người đang đăng nhập.
 *
 * Không cần quyền gì thêm, nhưng `userId` lấy từ token đã ký chứ không từ tham
 * số — không có cách nào đọc hộp thư của người khác.
 */
export async function GET(request: Request) {
  try {
    const session = await requireApiUser(request);

    const url = new URL(request.url);
    const parsed = listNotificationsSchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) throw apiErrors.validation(z.flattenError(parsed.error).fieldErrors);

    return apiOk(await notificationService.listForUser(session.sub, parsed.data));
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/notifications", request });
  }
}

/** Gửi thông báo — cần `notification:send`, khác hẳn quyền đọc hộp thư của mình. */
export async function POST(request: Request) {
  try {
    const session = await requireApiPermission(request, "notification:send");
    const body = await parseJsonBody(request, sendNotificationSchema);

    return apiOk(await notificationService.send(body, session.sub), 201);
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/notifications", request });
  }
}
