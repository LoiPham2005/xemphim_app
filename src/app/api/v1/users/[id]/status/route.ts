import { requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { setUserStatusSchema } from "@/schemas/user.schema";
import { userService } from "@/services/user.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Khoá/mở khoá thủ công — xem enum `UserStatus`. Khác `POST .../unlock` (khoá tạm tự động). */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiPermission(request, "user:update");
    const body = await parseJsonBody(request, setUserStatusSchema);

    const user = await userService.setStatus(id, body.status, { actorId: session.sub });

    return apiOk({ user });
  } catch (error) {
    return handleApiError(error, { route: "PATCH /api/v1/users/[id]/status", request });
  }
}
