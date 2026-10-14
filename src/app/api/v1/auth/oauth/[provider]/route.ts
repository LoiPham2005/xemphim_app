import { requireApiUser } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError } from "@/lib/api/response";
import { isOAuthProviderId } from "@/schemas/auth.schema";
import { oauthService } from "@/services/oauth.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ provider: string }> };

/**
 * Gỡ liên kết một tài khoản mạng xã hội.
 *
 * Service TỪ CHỐI nếu đây là cách đăng nhập cuối cùng (không có mật khẩu và
 * chỉ còn một liên kết) — gỡ được thì người dùng tự khoá mình ra ngoài.
 */
export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { provider } = await params;
    const session = await requireApiUser(request);

    if (!isOAuthProviderId(provider)) throw apiErrors.notFound("Nhà cung cấp không hợp lệ");

    await oauthService.unlink(session.sub, provider);

    return apiOk({ provider });
  } catch (error) {
    return handleApiError(error, { route: "DELETE /api/v1/auth/oauth/[provider]", request });
  }
}
