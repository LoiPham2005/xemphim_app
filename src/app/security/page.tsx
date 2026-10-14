import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { isWebAuthnConfigured } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { twoFactorService } from "@/services/two-factor.service";
import { webauthnService } from "@/services/webauthn.service";
import { PasskeyManager } from "./passkey-manager";
import { TwoFactorManager } from "./two-factor-manager";

export const metadata: Metadata = { title: "Bảo mật tài khoản" };
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const user = await requireUser("/security");

  // Gọi thẳng service, không đi qua REST API của chính mình: đây là Server
  // Component nên nó chạy cùng tiến trình — thêm một vòng HTTP chỉ để tự gọi
  // mình là lãng phí, và còn phải tự lo việc chuyển tiếp cookie.
  const [status, passkeys] = await Promise.all([
    twoFactorService.status(user.id),
    webauthnService.list(user.id),
  ]);

  return (
    <main className="container" style={{ maxWidth: 720 }}>
      <Link href="/" style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
        ← Quay lại trang chủ
      </Link>
      <h1 className="page-title">Bảo mật tài khoản</h1>
      <p className="page-subtitle">
        Thêm một lớp nữa ngoài mật khẩu. Bật ít nhất một trong hai cách dưới đây thì mật khẩu bị lộ
        cũng chưa đủ để đăng nhập.
      </p>

      <section className="card">
        <h2 style={{ fontSize: "1.2rem", marginBottom: 4 }}>Xác thực hai lớp (2FA)</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: 16 }}>
          Mã 6 số đổi mỗi 30 giây, sinh bởi ứng dụng trên điện thoại (Google Authenticator,
          1Password, Authy…). Không cần mạng.
        </p>

        <TwoFactorManager
          enabled={status.enabled}
          available={twoFactorService.isAvailable()}
          enabledAt={status.enabledAt ? formatDateTime(status.enabledAt) : null}
          recoveryCodesRemaining={status.remainingRecoveryCodes}
        />
      </section>

      <section className="card">
        <h2 style={{ fontSize: "1.2rem", marginBottom: 4 }}>Passkey</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: 16 }}>
          Vân tay, Face ID, Windows Hello hoặc khoá cứng. An toàn hơn mật khẩu + 2FA cộng lại: trình
          duyệt chỉ ký cho đúng tên miền đã đăng ký, nên trang giả không xin được chữ ký.
        </p>

        <PasskeyManager
          available={isWebAuthnConfigured()}
          passkeys={passkeys.map((passkey) => ({
            id: passkey.id,
            name: passkey.name,
            createdAt: formatDateTime(passkey.createdAt),
            lastUsedAt: passkey.lastUsedAt ? formatDateTime(passkey.lastUsedAt) : null,
          }))}
        />
      </section>

      <section className="card">
        <h2 style={{ fontSize: "1.2rem", marginBottom: 8 }}>Thiết bị đang đăng nhập</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
          Thấy thiết bị lạ thì đăng xuất nó ngay, rồi đổi mật khẩu.{" "}
          <Link href="/sessions">Xem danh sách →</Link>
        </p>
      </section>
    </main>
  );
}
