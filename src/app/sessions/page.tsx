import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { tokenService } from "@/services/token.service";
import { SessionRevokeButton } from "./session-revoke-button";

export const metadata: Metadata = { title: "Thiết bị đang đăng nhập" };
export const dynamic = "force-dynamic";

/**
 * Rút gọn chuỗi User-Agent thành một nhãn đọc được.
 *
 * Cố ý làm rất thô, không dùng thư viện phân tích UA. Lý do: mục đích duy nhất
 * ở đây là giúp người dùng NHẬN RA thiết bị của họ — "iPhone" hay "Windows" là
 * đủ. Phân tích chính xác phiên bản trình duyệt cần một thư viện với bảng dữ
 * liệu phải cập nhật liên tục, đổi lại gần như không thêm giá trị gì.
 *
 * Chuỗi gốc vẫn được hiện đầy đủ bên dưới, nên nhận nhầm cũng không mất gì.
 */
function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Thiết bị không rõ";

  const ua = userAgent.toLowerCase();

  // Thứ tự quan trọng: iPad cũng chứa "safari", Android cũng chứa "linux".
  if (ua.includes("iphone")) return "iPhone";
  if (ua.includes("ipad")) return "iPad";
  if (ua.includes("android")) return "Thiết bị Android";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "máy Mac";
  if (ua.includes("windows")) return "máy Windows";
  if (ua.includes("linux")) return "máy Linux";

  return "Thiết bị không rõ";
}

export default async function SessionsPage() {
  const user = await requireUser("/sessions");

  // Gọi thẳng service, không đi qua REST API của chính mình: đây là Server
  // Component nên nó chạy cùng tiến trình với service — thêm một vòng HTTP chỉ
  // để tự gọi mình là lãng phí, và còn phải tự lo việc chuyển tiếp cookie.
  const sessions = await tokenService.listActive(user.id);

  return (
    <main className="container" style={{ maxWidth: 720 }}>
      <h1 className="page-title">Thiết bị đang đăng nhập</h1>
      <p className="page-subtitle">
        Danh sách các thiết bị đã đăng nhập qua <strong>ứng dụng di động</strong>. Thấy thiết bị lạ
        thì đăng xuất nó ngay, rồi đổi mật khẩu.
      </p>

      {/*
        Lời giải thích này BẮT BUỘC phải có, nếu không người dùng sẽ hoang mang.

        Phiên đăng nhập trên WEB dùng cookie đã ký (JWT), không tạo dòng nào
        trong bảng refresh token — nên trình duyệt bạn đang ngồi KHÔNG xuất
        hiện ở đây. Danh sách trống không có nghĩa là bạn chưa đăng nhập.
      */}
      <div className="alert alert-warning" role="note" style={{ marginTop: 16 }}>
        Trình duyệt bạn đang dùng <strong>không</strong> nằm trong danh sách này. Phiên trên web
        dùng cookie, không phải refresh token — muốn thoát khỏi trình duyệt này thì bấm{" "}
        <strong>Đăng xuất</strong> ở đầu trang.
      </div>

      <section className="card" style={{ marginTop: 20 }}>
        {sessions.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)" }}>
            <p>Chưa có thiết bị di động nào đăng nhập vào tài khoản này.</p>
          </div>
        ) : (
          <ul className="user-list">
            {sessions.map((item) => {
              const label = describeUserAgent(item.userAgent);

              return (
                <li key={item.id} className="user-item">
                  <div className="user-info">
                    <span className="user-email">{label}</span>
                    <div className="user-meta">
                      <span>Đăng nhập: {formatDateTime(item.createdAt)}</span>
                      <span>Hết hạn: {formatDateTime(item.expiresAt)}</span>
                    </div>
                    {item.userAgent && (
                      <span
                        style={{
                          color: "var(--text-muted)",
                          fontSize: "0.75rem",
                          wordBreak: "break-all",
                        }}
                      >
                        {item.userAgent}
                      </span>
                    )}
                  </div>

                  <SessionRevokeButton sessionId={item.id} label={label} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
