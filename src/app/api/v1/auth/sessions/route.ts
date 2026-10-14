import { clientIp, requireApiUser } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { tokenService } from "@/services/token.service";
import { auditService } from "@/services/audit.service";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";

export const dynamic = "force-dynamic";

/**
 * Danh sách thiết bị đang đăng nhập.
 *
 * ---
 * VÌ SAO KHÔNG CẦN QUYỀN GÌ THÊM
 *
 * Ai cũng xem được — nhưng CHỈ phiên của chính mình. `session.sub` lấy từ
 * token đã ký, không phải từ tham số người gọi truyền vào, nên không có cách
 * nào hỏi danh sách của người khác.
 *
 * Cố ý KHÔNG cho admin xem phiên của người khác: đó là dữ liệu thiết bị và
 * thời điểm truy cập của họ. Nếu nghiệp vụ thật sự cần (hỗ trợ khách hàng
 * chẳng hạn) thì mở bằng một quyền riêng và ghi audit log, đừng thêm vào đây.
 *
 * ---
 * NHẬN RA "THIẾT BỊ NÀY"
 *
 * Response không tự đánh dấu phiên hiện tại, vì access token không mang thông
 * tin gì về refresh token đã sinh ra nó. Client tự đối chiếu với `sessionId`
 * nhận được lúc đăng nhập/refresh — xem `TokenPair` trong lib/api/tokens.ts.
 */
export async function GET(request: Request) {
  try {
    const session = await requireApiUser(request);

    const sessions = await tokenService.listActive(session.sub);

    return apiOk({
      sessions: sessions.map((item) => ({
        id: item.id,
        // Trả User-Agent THÔ, không tự dịch thành "iPhone · Safari". Việc dịch
        // phụ thuộc thư viện và cách hiển thị của từng client; làm ở đây là
        // ép mọi client dùng chung một cách diễn giải, và cách đó sẽ lỗi thời.
        userAgent: item.userAgent,
        createdAt: item.createdAt.toISOString(),
        expiresAt: item.expiresAt.toISOString(),
      })),
    });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/auth/sessions", request });
  }
}

/**
 * Đăng xuất MỌI thiết bị khác — nút "đăng xuất khỏi tất cả thiết bị".
 *
 * Giữ lại phiên hiện tại: đăng xuất luôn chính người đang bấm nút thì họ phải
 * đăng nhập lại ngay, và không ai muốn thế sau khi vừa xử lý một sự cố bảo mật.
 * Phiên hiện tại nhận ra qua `sid` trong access token (`familyId`, ổn định qua
 * mọi lần refresh).
 */
export async function DELETE(request: Request) {
  try {
    const session = await requireApiUser(request);

    const revoked = await tokenService.revokeAllForUser(session.sub, {
      ...(session.sid ? { exceptFamilyId: session.sid } : {}),
    });

    await auditService.record({
      action: AUDIT_ACTIONS.SESSION_REVOKED,
      entity: "user",
      entityId: session.sub,
      actorId: session.sub,
      actorEmail: session.email,
      metadata: { revoked, scope: "all_other_devices" },
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    return apiOk({ revoked });
  } catch (error) {
    return handleApiError(error, { route: "DELETE /api/v1/auth/sessions", request });
  }
}
