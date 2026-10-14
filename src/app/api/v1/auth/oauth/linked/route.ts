import { requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { oauthService } from "@/services/oauth.service";

export const dynamic = "force-dynamic";

/** Các tài khoản mạng xã hội đã liên kết với tài khoản đang đăng nhập. */
export async function GET(request: Request) {
  try {
    const session = await requireApiUser(request);

    return apiOk({ linked: await oauthService.listLinked(session.sub) });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/auth/oauth/linked", request });
  }
}
