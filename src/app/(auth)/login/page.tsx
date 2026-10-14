import type { Metadata } from "next";
import Link from "next/link";
import { OAuthButtons, OAuthErrorBanner } from "../oauth-buttons";
import { LoginForm } from "./login-form";
import { PasskeyButton } from "./passkey-button";

export const metadata: Metadata = { title: "Đăng nhập" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; oauthError?: string; reset?: string }>;
}) {
  const { next, oauthError, reset } = await searchParams;

  return (
    <main className="container" style={{ maxWidth: 440 }}>
      <div className="card">
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 4 }}>Đăng nhập</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: 24 }}>
          Nhập thông tin tài khoản của bạn để tiếp tục.
        </p>

        {/*
          `?reset=1` do `resetPasswordAction` gắn vào sau khi đổi mật khẩu
          thành công. Không có nó thì người dùng bị đá về trang đăng nhập mà
          không biết việc đặt lại đã xong hay vừa thất bại.
        */}
        {reset && (
          <div className="alert alert-success" role="status" style={{ marginBottom: 16 }}>
            Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.
          </div>
        )}

        <OAuthErrorBanner code={oauthError} />
        <OAuthButtons next={next} />

        <LoginForm nextPath={next} />

        {/* Dưới form mật khẩu, không phải trên: passkey vẫn là lựa chọn thứ
            hai với đa số người dùng hôm nay, và đảo thứ tự làm màn hình quen
            thuộc trở nên lạ. Nút tự ẩn nếu trình duyệt không hỗ trợ. */}
        <PasskeyButton nextPath={next} />

        <p style={{ marginTop: 20, fontSize: "0.9rem", color: "var(--text-muted)" }}>
          <Link href="/forgot-password">Quên mật khẩu?</Link>
        </p>
        <p style={{ marginTop: 8, fontSize: "0.9rem", color: "var(--text-muted)" }}>
          Chưa có tài khoản? <Link href="/register">Đăng ký</Link>
        </p>
      </div>
    </main>
  );
}
