import "server-only";
import { decodeJwt } from "jose";
import { getAppleClientSecret } from "./apple-client-secret";
import { callbackUrl, isProviderConfigured, PROVIDER_CONFIG } from "./config";
import { OAuthExchangeError, OAuthProviderNotConfiguredError, type OAuthProviderId } from "./types";
import { env } from "@/lib/env";

export function buildAuthorizationUrl(
  provider: OAuthProviderId,
  params: { state: string; codeChallenge?: string },
): URL {
  if (!isProviderConfigured(provider)) throw new OAuthProviderNotConfiguredError(provider);

  const config = PROVIDER_CONFIG[provider];
  const url = new URL(config.authorizationEndpoint);

  url.searchParams.set("client_id", config.clientId!);
  url.searchParams.set("redirect_uri", callbackUrl(provider));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", params.state);

  if (config.responseMode) url.searchParams.set("response_mode", config.responseMode);

  if (config.usePkce && params.codeChallenge) {
    url.searchParams.set("code_challenge", params.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }

  return url;
}

async function resolveClientSecret(provider: OAuthProviderId): Promise<string> {
  if (provider === "apple") return getAppleClientSecret();

  const secret = {
    google: env.GOOGLE_CLIENT_SECRET,
    github: env.GITHUB_CLIENT_SECRET,
    facebook: env.FACEBOOK_CLIENT_SECRET,
  }[provider];

  if (!secret) throw new OAuthProviderNotConfiguredError(provider);
  return secret;
}

export type ExchangedTokens = {
  accessToken: string;
  /** Chỉ Google/Apple trả — chứa danh tính đã ký, dùng để lấy hồ sơ mà không cần gọi thêm API. */
  idToken?: string;
};

/**
 * Đổi authorization code lấy token.
 *
 * Không throw nguyên lỗi mạng/HTTP ra ngoài — bọc thành `OAuthExchangeError`
 * để route callback chỉ cần một nhánh xử lý, không phải phân biệt "provider
 * từ chối code" với "provider sập" với "JSON hỏng".
 */
export async function exchangeCodeForToken(
  provider: OAuthProviderId,
  code: string,
  codeVerifier?: string,
): Promise<ExchangedTokens> {
  if (!isProviderConfigured(provider)) throw new OAuthProviderNotConfiguredError(provider);

  const config = PROVIDER_CONFIG[provider];
  const clientId = config.clientId!;
  const clientSecret = await resolveClientSecret(provider);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(provider),
    client_id: clientId,
    client_secret: clientSecret,
  });

  if (config.usePkce && codeVerifier) body.set("code_verifier", codeVerifier);

  try {
    const response = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`Token endpoint trả về ${response.status}: ${await response.text()}`);
    }

    const json = (await response.json()) as { access_token?: string; id_token?: string };
    if (!json.access_token) throw new Error("Thiếu access_token trong phản hồi");

    return { accessToken: json.access_token, idToken: json.id_token };
  } catch (error) {
    throw new OAuthExchangeError(provider, error);
  }
}

/**
 * Claims tối thiểu cần từ id_token (Google/Apple) hoặc REST profile
 * (Github/Facebook) — chưa qua bước xác định "đã xác thực chưa", việc đó do
 * `profile.ts` quyết định vì mỗi provider biểu diễn khác nhau (boolean vs
 * string "true"/"false", có field riêng hay ngầm định).
 */
export type RawIdTokenClaims = {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
};

/**
 * Giải mã id_token KHÔNG kiểm chữ ký.
 *
 * An toàn ở đây vì id_token tới trực tiếp từ token endpoint của provider qua
 * kênh HTTPS đã xác thực bằng `client_secret` (kênh "back-channel") — khác
 * hẳn trường hợp id_token đi qua trình duyệt (kênh "front-channel"), nơi bắt
 * buộc phải verify chữ ký vì bất kỳ ai cũng có thể chèn token giả vào.
 */
export function decodeIdToken(idToken: string): RawIdTokenClaims {
  return decodeJwt(idToken);
}
