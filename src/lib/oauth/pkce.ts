import { createHash, randomBytes } from "node:crypto";

/**
 * `state` (chống CSRF) và PKCE `code_verifier`/`code_challenge` (chống đánh
 * cắp authorization code) cho luồng OAuth 2.0 Authorization Code.
 *
 * Cùng họ với `opaque-token.ts`: 32 byte ngẫu nhiên, base64url. Không dùng lại
 * trực tiếp `generateOpaqueToken` vì hai giá trị này không lưu database — chỉ
 * sống trong cookie vài phút — nên không cần các hàm hash/so sánh đi kèm ở đó.
 */
export function generateOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** RFC 7636 — S256: BASE64URL(SHA256(code_verifier)), không padding. */
export function createCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}
