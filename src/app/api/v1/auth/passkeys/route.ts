import { requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { isWebAuthnConfigured } from "@/lib/env";
import { webauthnService } from "@/services/webauthn.service";

export const dynamic = "force-dynamic";

/**
 * Đăng nhập bằng passkey (vân tay / Face ID / Windows Hello / khoá cứng).
 *
 * ---
 * MỖI LUỒNG LÀ HAI BƯỚC, VÀ BƯỚC ĐẦU LUÔN CẤP MỘT "VÉ"
 *
 * WebAuthn yêu cầu máy chủ sinh một `challenge` ngẫu nhiên rồi đối chiếu chính
 * nó ở bước xác minh — không có bước đó thì một phản hồi cũ phát lại được.
 *
 * Vé là JWT ngắn hạn chứa `challenge`, mang `typ: "webauthn_*"` nên không dùng
 * thay access token được (xem `src/lib/tickets.ts`). Đổi lại: không cần bảng
 * lưu challenge, không cần job dọn dẹp.
 */
export async function GET(request: Request) {
  try {
    const session = await requireApiUser(request);

    // `available` cho giao diện biết có nên hiện nút "Thêm passkey" không.
    // Hiện một nút mà bấm vào chỉ ra lỗi cấu hình máy chủ thì tệ hơn là ẩn nó.
    return apiOk({
      passkeys: await webauthnService.list(session.sub),
      available: isWebAuthnConfigured(),
    });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/auth/passkeys", request });
  }
}
