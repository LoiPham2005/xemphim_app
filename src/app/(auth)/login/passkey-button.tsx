"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getPasskeyLoginOptions, verifyPasskeyLogin } from "./passkey-actions";

/**
 * Nút "Đăng nhập bằng passkey".
 *
 * Không cần nhập email: trình duyệt tự hiện mọi passkey đã lưu cho tên miền
 * này, người dùng chọn một cái rồi mở khoá bằng vân tay/Face ID. Một chạm, và
 * an toàn hơn mật khẩu + TOTP cộng lại — vì trang giả không xin được chữ ký.
 */
export function PasskeyButton({ nextPath }: { nextPath?: string }) {
  const router = useRouter();
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Kiểm tra trong `useEffect` chứ không phải lúc render: `window` không tồn
    // tại khi Next render phía server, và một nút "đăng nhập bằng passkey"
    // hiện trên trình duyệt không hỗ trợ chỉ dẫn tới ngõ cụt.
    void import("@simplewebauthn/browser").then(({ browserSupportsWebAuthn }) => {
      setSupported(browserSupportsWebAuthn());
    });
  }, []);

  if (!supported) return null;

  async function handleClick() {
    setBusy(true);
    setError(null);

    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const { options, challengeToken } = await getPasskeyLoginOptions();

      // Bước này mở secure enclave của thiết bị. Trình duyệt CHỈ ký cho đúng
      // tên miền đã đăng ký — đó là toàn bộ lý do passkey chống được phishing.
      const response = await startAuthentication({ optionsJSON: options });

      const result = await verifyPasskeyLogin(challengeToken, response, nextPath);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      router.push(result.next);
      // Server Component đọc cookie phiên vừa được đặt — không refresh thì
      // trang đích vẫn render theo trạng thái "chưa đăng nhập".
      router.refresh();
    } catch (err) {
      // Người dùng bấm Huỷ ở hộp thoại hệ điều hành cũng rơi vào đây. Không
      // phải lỗi — đừng hét lên.
      const name = err instanceof Error ? err.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") {
        setError("Không dùng được passkey trên thiết bị này.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <Button
        type="button"
        variant="outline"
        onClick={() => void handleClick()}
        disabled={busy}
        style={{ width: "100%" }}
      >
        {busy ? "Đang chờ thiết bị…" : "🔑 Đăng nhập bằng passkey"}
      </Button>

      <p
        style={{
          marginTop: 8,
          textAlign: "center",
          fontSize: "0.85rem",
          color: "var(--text-muted)",
        }}
      >
        Không cần nhập email. Mở khoá bằng vân tay hoặc Face ID.
      </p>

      {error && (
        <p role="alert" className="alert alert-danger">
          {error}
        </p>
      )}
    </div>
  );
}
