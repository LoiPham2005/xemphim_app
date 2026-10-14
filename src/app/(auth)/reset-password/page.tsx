import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Đặt lại mật khẩu" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="container" style={{ maxWidth: 440 }}>
      <div className="card">
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 4 }}>Đặt lại mật khẩu</h1>

        {token ? (
          <>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: 24 }}>
              Nhập mật khẩu mới. Mọi thiết bị đang đăng nhập sẽ bị đăng xuất.
            </p>
            <ResetPasswordForm token={token} />
          </>
        ) : (
          /*
           * Thiếu token nghĩa là người dùng vào thẳng đường dẫn này chứ không
           * đi từ email. Không dựng form ở đây: một ô mật khẩu không gắn với
           * tài khoản nào chỉ khiến họ gõ xong rồi nhận lỗi khó hiểu.
           */
          <>
            <div className="alert alert-danger" role="alert">
              Liên kết không hợp lệ hoặc đã hết hạn.
            </div>
            <p style={{ marginTop: 20, fontSize: "0.9rem", color: "var(--text-muted)" }}>
              <Link href="/forgot-password">Yêu cầu gửi lại liên kết</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
