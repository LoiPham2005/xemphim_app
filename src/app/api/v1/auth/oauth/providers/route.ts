import { apiOk, handleApiError } from "@/lib/api/response";
import { configuredOAuthProviders } from "@/lib/oauth/config";

export const dynamic = "force-dynamic";

/**
 * Nhà cung cấp OAuth ĐÃ cấu hình xong trên máy chủ này.
 *
 * CÔNG KHAI, và cố ý: màn đăng nhập cần biết nên vẽ nút nào TRƯỚC khi người
 * dùng đăng nhập. Vẽ nút "Đăng nhập với Apple" rồi bấm vào ra lỗi cấu hình thì
 * tệ hơn hẳn là không vẽ nút đó.
 *
 * Không lộ gì nhạy cảm: chỉ là tên nhà cung cấp, còn client id thì đằng nào
 * cũng xuất hiện trong URL chuyển hướng.
 */
export function GET(request: Request) {
  try {
    return apiOk({ providers: configuredOAuthProviders() });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/auth/oauth/providers", request });
  }
}
