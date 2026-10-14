import type { Metadata } from "next";
import Link from "next/link";
import { VerifyEmailForm } from "./verify-email-form";

export const metadata: Metadata = { title: "Xác thực email" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="container" style={{ maxWidth: 440 }}>
      <div className="card">
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 4 }}>Xác thực email</h1>

        {token ? (
          <>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: 24 }}>
              {/*
                Trang này KHÔNG tự xác thực khi mở. Token chỉ dùng được một
                lần, mà bộ quét link của Gmail/Outlook tự mở mọi URL trong thư
                để kiểm tra an toàn — nếu tiêu thụ token ngay lúc GET thì nó
                bị đốt trước khi người dùng kịp bấm, và họ nhận được thông báo
                "liên kết đã hết hạn" cho một liên kết vừa gửi xong.
              */}
              Nhấn nút bên dưới để xác nhận địa chỉ email này là của bạn.
            </p>
            <VerifyEmailForm token={token} />
          </>
        ) : (
          <>
            <div className="alert alert-danger" role="alert">
              Liên kết không hợp lệ hoặc đã hết hạn.
            </div>
            <p style={{ marginTop: 20, fontSize: "0.9rem", color: "var(--text-muted)" }}>
              Đăng nhập rồi yêu cầu gửi lại email xác thực. <Link href="/login">Đăng nhập</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
