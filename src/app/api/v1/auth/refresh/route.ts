import { z } from "zod";
import { enforceRateLimit } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { ACCESS_TOKEN_MAX_AGE_SECONDS, signSession } from "@/lib/session";
import { userService } from "@/services/user.service";
import { tokenService } from "@/services/token.service";

export const dynamic = "force-dynamic";

const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Thiếu refreshToken"),
});

/**
 * Đổi refresh token lấy cặp token mới.
 *
 * Endpoint này KHÔNG dùng access token: client gọi tới đây chính vì access
 * token đã hết hạn.
 */
export async function POST(request: Request) {
  try {
    await enforceRateLimit(request, "api:refresh", RATE_LIMITS.refresh);

    const { refreshToken } = await parseJsonBody(request, refreshSchema);

    const rotated = await tokenService.rotate(refreshToken, {
      userAgent: request.headers.get("user-agent"),
    });

    // null = token không tồn tại hoặc đã hết hạn. Trường hợp token bị dùng lại
    // sau khi thu hồi thì service ném RefreshTokenReuseError và huỷ mọi phiên;
    // handleApiError chuyển nó thành 401.
    if (!rotated) {
      throw apiErrors.unauthenticated("Refresh token không hợp lệ hoặc đã hết hạn");
    }

    /*
     * Tra lại user thay vì tin dữ liệu gắn kèm token cũ.
     *
     * Refresh là đúng thời điểm để nhặt thay đổi: vai trò có thể vừa bị gỡ,
     * tài khoản có thể vừa bị khoá. Ký lại một token mang vai trò cũ là kéo dài
     * thêm một vòng đời cho trạng thái đã lỗi thời.
     */
    const user = await userService.findById(rotated.userId);
    if (!user) throw apiErrors.unauthenticated("Refresh token không hợp lệ hoặc đã hết hạn");

    const accessToken = await signSession(
      {
        typ: "access",
        sub: user.id,
        email: user.email,
        roles: user.roles,
        sid: rotated.refresh.familyId,
      },
      ACCESS_TOKEN_MAX_AGE_SECONDS,
    );

    return apiOk({
      accessToken,
      expiresIn: ACCESS_TOKEN_MAX_AGE_SECONDS,
      tokenType: "Bearer" as const,
      refreshToken: rotated.refresh.token,
      refreshExpiresAt: rotated.refresh.expiresAt.toISOString(),
      /*
       * `familyId`, KHÔNG phải `id` của bản ghi token.
       *
       * `id` đổi sau MỖI lần refresh vì token xoay vòng, còn `familyId` thì
       * không — và `GET /auth/sessions` liệt kê theo `familyId`. Trả `id` ở
       * đây thì sau lần refresh đầu tiên, giá trị client đang giữ không còn
       * khớp dòng nào trong danh sách: màn "thiết bị đang đăng nhập" không bao
       * giờ đánh dấu được thiết bị hiện tại, và `DELETE /auth/sessions/{id}`
       * với giá trị đó trả 404.
       *
       * Phải khớp với `issueTokenPair` — login và refresh mà trả hai loại giá
       * trị khác nhau cho cùng một trường là bẫy cho mọi client.
       */
      sessionId: rotated.refresh.familyId,
    });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/refresh", request });
  }
}
