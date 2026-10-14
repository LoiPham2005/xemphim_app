import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmEmailChangeForm } from "./confirm-email-change-form";

export const metadata: Metadata = { title: "Xác nhận đổi email" };

export default async function ConfirmEmailChangePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="container" style={{ maxWidth: 440 }}>
      <div className="card">
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 4 }}>Xác nhận đổi email</h1>

        {token ? (
          <>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: 24 }}>
              {/*
                Như /verify-email: KHÔNG tự xác nhận khi mở trang. Token dùng
                một lần, mà bộ quét link của Gmail/Outlook tự mở mọi URL trong
                thư — tiêu thụ token ngay lúc GET thì nó bị đốt trước khi người
                dùng kịp bấm.
              */}
              Nhấn nút bên dưới để chuyển tài khoản sang địa chỉ email mới. Địa chỉ cũ sẽ không còn
              đăng nhập được.
            </p>
            <ConfirmEmailChangeForm token={token} />
          </>
        ) : (
          <>
            <div className="alert alert-danger" role="alert">
              Liên kết không hợp lệ hoặc đã hết hạn.
            </div>
            <p style={{ marginTop: 20, fontSize: "0.9rem", color: "var(--text-muted)" }}>
              Đăng nhập rồi yêu cầu đổi email lại. <Link href="/login">Đăng nhập</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
