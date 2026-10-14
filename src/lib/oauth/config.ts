import { env, publicAppUrl } from "@/lib/env";
import { apiPath } from "@/lib/api/version";
import { OAUTH_PROVIDERS, type OAuthProviderId } from "./types";

export type ProviderConfig = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scope: string;
  /** false = Github không hỗ trợ PKCE trên OAuth Apps cổ điển. */
  usePkce: boolean;
  /** Apple bắt buộc `response_mode=form_post` khi xin scope name/email. */
  responseMode?: "form_post";
  clientId: string | undefined;
};

export const PROVIDER_CONFIG: Record<OAuthProviderId, ProviderConfig> = {
  google: {
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    usePkce: true,
    clientId: env.GOOGLE_CLIENT_ID,
  },
  github: {
    authorizationEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    usePkce: false,
    clientId: env.GITHUB_CLIENT_ID,
  },
  facebook: {
    authorizationEndpoint: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenEndpoint: "https://graph.facebook.com/v21.0/oauth/access_token",
    scope: "email public_profile",
    usePkce: true,
    clientId: env.FACEBOOK_CLIENT_ID,
  },
  apple: {
    authorizationEndpoint: "https://appleid.apple.com/auth/authorize",
    tokenEndpoint: "https://appleid.apple.com/auth/token",
    scope: "name email",
    usePkce: false,
    responseMode: "form_post",
    clientId: env.APPLE_CLIENT_ID,
  },
};

/**
 * Provider có đủ credential để dùng chưa. Route `start`/`callback` gọi hàm
 * này trước tiên — thiếu cấu hình phải báo lỗi rõ ràng, không được 500 mù mờ.
 */
export function isProviderConfigured(provider: OAuthProviderId): boolean {
  switch (provider) {
    case "google":
      return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
    case "github":
      return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
    case "facebook":
      return Boolean(env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET);
    case "apple":
      return Boolean(
        env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY,
      );
  }
}

/**
 * Danh sách provider ĐÃ cấu hình xong. Màn đăng nhập dùng nó để biết vẽ nút
 * nào — vẽ một nút mà bấm vào ra lỗi cấu hình thì tệ hơn hẳn là không vẽ.
 */
export function configuredOAuthProviders(): OAuthProviderId[] {
  return OAUTH_PROVIDERS.filter(isProviderConfigured);
}

/** redirect_uri phải TUYỆT ĐỐI và khớp 100% với cấu hình trên console của provider. */
export function callbackUrl(provider: OAuthProviderId): string {
  if (!publicAppUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL là bắt buộc để dùng đăng nhập OAuth");
  }
  return `${publicAppUrl}${apiPath(`/auth/oauth/${provider}/callback`)}`;
}
