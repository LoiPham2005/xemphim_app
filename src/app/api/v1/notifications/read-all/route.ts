import { requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { notificationService } from "@/services/notification.service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await requireApiUser(request);

    return apiOk({ marked: await notificationService.markAllRead(session.sub) });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/notifications/read-all", request });
  }
}
