import Link from "next/link";
import { apiPath } from "@/lib/api/version";
import { Button } from "@/components/ui/button";
import { isProviderConfigured } from "@/lib/oauth/config";
import { OAUTH_PROVIDERS, type OAuthProviderId } from "@/lib/oauth/types";

const LABELS: Record<OAuthProviderId, string> = {
  google: "Google",
  github: "Github",
  facebook: "Facebook",
  apple: "Apple",
};

/**
 * Chỉ hiện nút của provider ĐÃ CẤU HÌNH — thiếu CLIENT_ID/SECRET thì ẩn hẳn
 * thay vì hiện nút rồi bấm vào mới báo lỗi.
 */
export function OAuthButtons({ next }: { next?: string }) {
  const configured = OAUTH_PROVIDERS.filter(isProviderConfigured);
  if (configured.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
      {configured.map((provider) => (
        <Button key={provider} asChild variant="secondary" className="w-full">
          <Link
            href={`${apiPath(`/auth/oauth/${provider}/start`)}${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          >
            Tiếp tục với {LABELS[provider]}
          </Link>
        </Button>
      ))}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          margin: "8px 0 0",
          color: "var(--text-muted)",
          fontSize: "0.8rem",
        }}
      >
        <div style={{ flex: 1, height: 1, background: "var(--border-color)" }} />
        hoặc
        <div style={{ flex: 1, height: 1, background: "var(--border-color)" }} />
      </div>
    </div>
  );
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Bạn đã huỷ đăng nhập.",
  state_mismatch: "Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.",
  not_configured: "Phương thức đăng nhập này chưa được bật.",
  email_required:
    "Tài khoản mạng xã hội của bạn không có email đã xác thực để liên kết. Vui lòng công khai/xác thực email rồi thử lại.",
  exchange_failed: "Không đăng nhập được. Vui lòng thử lại.",
  banned: "Tài khoản đã bị khoá. Vui lòng liên hệ quản trị viên.",
  account_unavailable: "Tài khoản không còn khả dụng.",
  invalid_provider: "Phương thức đăng nhập không hợp lệ.",
  unknown: "Có lỗi xảy ra khi đăng nhập. Vui lòng thử lại.",
};

export function OAuthErrorBanner({ code }: { code?: string }) {
  if (!code) return null;
  const message = OAUTH_ERROR_MESSAGES[code] ?? OAUTH_ERROR_MESSAGES.unknown;

  return (
    <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}>
      {message}
    </div>
  );
}
