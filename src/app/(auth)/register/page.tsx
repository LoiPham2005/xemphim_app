import type { Metadata } from "next";
import Link from "next/link";
import { OAuthButtons } from "../oauth-buttons";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Đăng ký" };

export default function RegisterPage() {
  return (
    <main className="container" style={{ maxWidth: 440 }}>
      <div className="card">
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 4 }}>Tạo tài khoản</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: 24 }}>
          Tài khoản mới luôn được tạo với quyền USER.
        </p>

        <OAuthButtons />

        <RegisterForm />

        <p style={{ marginTop: 20, fontSize: "0.9rem", color: "var(--text-muted)" }}>
          Đã có tài khoản? <Link href="/login">Đăng nhập</Link>
        </p>
      </div>
    </main>
  );
}
