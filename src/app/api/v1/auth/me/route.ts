import { requireApiUser } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError } from "@/lib/api/response";
import { userService } from "@/services/user.service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireApiUser(request);

    // Đọc lại từ database chứ không trả thẳng nội dung token: quyền có thể đã
    // đổi, hoặc tài khoản đã bị xoá, kể từ lúc token được cấp.
    const user = await userService.findById(session.sub);
    if (!user) throw apiErrors.unauthenticated("Tài khoản không còn tồn tại");

    return apiOk({ user });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/auth/me", request });
  }
}
