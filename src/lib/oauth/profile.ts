import "server-only";
import { decodeIdToken, type ExchangedTokens } from "./client";
import { OAuthExchangeError, type OAuthProfile, type OAuthProviderId } from "./types";

/**
 * `user` chỉ được Apple gửi (qua form POST, không phải token response) trong
 * LẦN ĐẦU người dùng cấp quyền cho app — những lần sau `id_token` vẫn có
 * nhưng field này biến mất vĩnh viễn. Route callback phải tự đọc và truyền
 * xuống đây, `client.ts` không thấy được giá trị này.
 */
export type AppleFormPostUser = { name?: { firstName?: string; lastName?: string } };

async function fetchGithubProfile(accessToken: string): Promise<OAuthProfile> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "xemphim",
  };

  const [userRes, emailsRes] = await Promise.all([
    fetch("https://api.github.com/user", { headers }),
    fetch("https://api.github.com/user/emails", { headers }),
  ]);

  if (!userRes.ok) throw new OAuthExchangeError("github", await userRes.text());

  const user = (await userRes.json()) as { id: number; name: string | null; login: string };

  // /user/emails có thể 403 nếu token thiếu scope `user:email` — không coi là
  // lỗi cứng, chỉ là không lấy được email (oauthService sẽ báo người dùng bổ
  // sung email đã xác thực trên Github).
  let email: string | null = null;
  if (emailsRes.ok) {
    const emails = (await emailsRes.json()) as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }>;
    email = emails.find((item) => item.primary && item.verified)?.email ?? null;
  }

  return {
    provider: "github",
    providerAccountId: String(user.id),
    email,
    fullName: user.name ?? user.login,
  };
}

async function fetchFacebookProfile(accessToken: string): Promise<OAuthProfile> {
  const url = new URL("https://graph.facebook.com/v21.0/me");
  url.searchParams.set("fields", "id,name,email");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  if (!response.ok) throw new OAuthExchangeError("facebook", await response.text());

  const profile = (await response.json()) as { id: string; name?: string; email?: string };

  return {
    provider: "facebook",
    providerAccountId: profile.id,
    // Facebook chỉ trả field `email` khi đã xác thực quyền sở hữu — không có
    // field "verified" riêng để kiểm thêm.
    email: profile.email ?? null,
    fullName: profile.name ?? null,
  };
}

function isVerified(value: boolean | string | undefined): boolean {
  return value === true || value === "true";
}

function fromIdToken(provider: "google" | "apple", idToken: string): OAuthProfile {
  const claims = decodeIdToken(idToken);

  return {
    provider,
    providerAccountId: claims.sub,
    email: isVerified(claims.email_verified) ? (claims.email ?? null) : null,
    fullName: claims.name ?? null,
  };
}

export async function fetchOAuthProfile(
  provider: OAuthProviderId,
  tokens: ExchangedTokens,
  appleUser?: AppleFormPostUser,
): Promise<OAuthProfile> {
  switch (provider) {
    case "github":
      return fetchGithubProfile(tokens.accessToken);
    case "facebook":
      return fetchFacebookProfile(tokens.accessToken);
    case "google": {
      if (!tokens.idToken) throw new OAuthExchangeError(provider, "Thiếu id_token");
      return fromIdToken("google", tokens.idToken);
    }
    case "apple": {
      if (!tokens.idToken) throw new OAuthExchangeError(provider, "Thiếu id_token");
      const profile = fromIdToken("apple", tokens.idToken);
      const name = appleUser?.name;
      if (name) {
        profile.fullName = [name.firstName, name.lastName].filter(Boolean).join(" ") || null;
      }
      return profile;
    }
  }
}
