"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { removePasskeyAction } from "./actions";

type PasskeyRow = {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

/**
 * Thêm/xoá passkey.
 *
 * Việc THÊM đi qua REST (`/api/v1/auth/passkeys/register/*`) chứ không qua
 * Server Action: `navigator.credentials.create()` trả về một đối tượng có
 * `ArrayBuffer` bên trong, và thư viện `@simplewebauthn/browser` đã chuyển nó
 * thành JSON thuần. Gửi JSON đó qua `fetch` là thẳng nhất — cùng endpoint mà
 * app mobile dùng, nên không có hai đường code phải giữ cho khớp nhau.
 *
 * Cookie phiên đi kèm tự động (`getApiSession` đọc header Authorization trước,
 * rồi mới tới cookie), và cookie đặt `sameSite: "lax"` nên không CSRF được.
 */
export function PasskeyManager({
  available,
  passkeys,
}: {
  available: boolean;
  passkeys: PasskeyRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void import("@simplewebauthn/browser").then(({ browserSupportsWebAuthn }) => {
      setSupported(browserSupportsWebAuthn());
    });
  }, []);

  if (!available) {
    return (
      <p className="alert alert-warning">
        Máy chủ chưa cấu hình WebAuthn. Cần <code>APP_URL</code> (hoặc <code>WEBAUTHN_RP_ID</code> +{" "}
        <code>WEBAUTHN_ORIGINS</code>) trong <code>.env</code>.
      </p>
    );
  }

  async function handleAdd() {
    setBusy(true);
    setError(null);

    try {
      const { startRegistration } = await import("@simplewebauthn/browser");

      const optionsResponse = await fetch("/api/v1/auth/passkeys/register/options", {
        method: "POST",
      });
      if (!optionsResponse.ok) throw new Error("options");

      /*
       * Ép kiểu ở ĐÂY là không tránh được: `response.json()` trả `any`, và
       * đây là ranh giới HTTP thật.
       *
       * Không mô tả lại cấu trúc WebAuthn bằng Zod là có chủ đích — đặc tả còn
       * đang tiến hoá, và một bản chép tay sẽ bắt đầu từ chối những trình
       * duyệt hợp lệ. Giá trị này do CHÍNH máy chủ của ta sinh ra ở bước
       * `/register/options`, nên nó không phải dữ liệu không tin được.
       */
      const { data } = (await optionsResponse.json()) as {
        data: {
          options: Parameters<typeof startRegistration>[0]["optionsJSON"];
          challengeToken: string;
        };
      };

      const credential = await startRegistration({ optionsJSON: data.options });

      const verifyResponse = await fetch("/api/v1/auth/passkeys/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeToken: data.challengeToken,
          response: credential,
          // Tên gợi nhớ để người dùng phân biệt nhiều thiết bị. Không bắt nhập
          // ở bước này — thêm một hộp thoại nữa giữa lúc chờ vân tay là cách
          // nhanh nhất khiến người ta bỏ dở.
          name: navigator.platform || null,
        }),
      });

      if (!verifyResponse.ok) {
        const body = (await verifyResponse.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "Không lưu được passkey.");
        return;
      }

      router.refresh();
    } catch (err) {
      // Người dùng bấm Huỷ ở hộp thoại hệ điều hành cũng rơi vào đây. Không
      // phải lỗi — đừng hét lên.
      const name = err instanceof Error ? err.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") {
        setError("Không tạo được passkey trên thiết bị này.");
      }
    } finally {
      setBusy(false);
    }
  }

  const handleRemove = (id: string, label: string) => {
    if (typeof window !== "undefined" && !window.confirm(`Xoá passkey "${label}"?`)) return;

    setError(null);
    startTransition(async () => {
      // Service từ chối nếu đây là cách đăng nhập CUỐI CÙNG — xoá được thì
      // người dùng tự khoá mình ra ngoài vĩnh viễn.
      const result = await removePasskeyAction(id);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {passkeys.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>Chưa có passkey nào.</p>
      ) : (
        <ul className="user-list">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="user-item">
              <div className="user-info">
                <span className="user-email">{passkey.name ?? "Passkey không tên"}</span>
                <div className="user-meta">
                  <span>Tạo {passkey.createdAt}</span>
                  <span>
                    {passkey.lastUsedAt ? `Dùng lần cuối ${passkey.lastUsedAt}` : "Chưa dùng"}
                  </span>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => handleRemove(passkey.id, passkey.name ?? "Passkey không tên")}
              >
                Xoá
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="alert alert-danger">
          {error}
        </p>
      )}

      {supported ? (
        <Button type="button" onClick={() => void handleAdd()} disabled={busy}>
          {busy ? "Đang chờ thiết bị…" : "➕ Thêm passkey"}
        </Button>
      ) : (
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
          Trình duyệt này không hỗ trợ passkey.
        </p>
      )}
    </div>
  );
}
