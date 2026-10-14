import { requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { userService } from "@/services/user.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Mở khoá sớm — xoá `lockedUntil` do brute-force thay vì đợi tự hết hạn. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    await requireApiPermission(request, "user:update");

    const user = await userService.unlock(id);

    return apiOk({ user });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/users/[id]/unlock", request });
  }
}
