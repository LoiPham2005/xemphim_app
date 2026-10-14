import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Quên mật khẩu" };

export default function ForgotPasswordPage() {
  return (
    <main className="container" style={{ maxWidth: 440 }}>
      <div className="card">
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 4 }}>Quên mật khẩu</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: 24 }}>
          Nhập email đã đăng ký. Chúng tôi sẽ gửi liên kết đặt lại mật khẩu.
        </p>

        <ForgotPasswordForm />

        <p style={{ marginTop: 20, fontSize: "0.9rem", color: "var(--text-muted)" }}>
          Nhớ ra rồi? <Link href="/login">Quay lại đăng nhập</Link>
        </p>
      </div>
    </main>
  );
}
