import { SignJWT, importPKCS8 } from "jose";
import { env } from "@/lib/env";

/**
 * Apple không có client secret tĩnh: secret là một JWT tự ký (ES256) bằng
 * private key .p8 tải từ Apple Developer, hạn tối đa 6 tháng theo quy định
 * của Apple. Thay vì bắt người vận hành tự sinh và xoay vòng JWT đó thủ công,
 * mint lúc chạy và cache lại tới gần hết hạn.
 *
 * Hạn đặt 5 phút — ngắn hơn nhiều mức 6 tháng Apple cho phép — để đổi khoá
 * (APPLE_PRIVATE_KEY) có hiệu lực gần như ngay lập tức thay vì phải đợi tới
 * khi secret cũ hết hạn.
 */
const SECRET_TTL_SECONDS = 5 * 60;

let cached: { secret: string; expiresAt: number } | null = null;

export async function getAppleClientSecret(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  if (cached && cached.expiresAt > now + 30) {
    return cached.secret;
  }

  if (!env.APPLE_TEAM_ID || !env.APPLE_KEY_ID || !env.APPLE_PRIVATE_KEY || !env.APPLE_CLIENT_ID) {
    throw new Error(
      "Thiếu biến môi trường APPLE_TEAM_ID/APPLE_KEY_ID/APPLE_PRIVATE_KEY/APPLE_CLIENT_ID",
    );
  }

  // Khoá .p8 tải từ Apple Developer thường được dán vào .env với `\n` theo
  // nghĩa đen thay vì xuống dòng thật — chuyển lại trước khi parse PEM.
  const privateKey = await importPKCS8(env.APPLE_PRIVATE_KEY.replace(/\\n/g, "\n"), "ES256");

  const expiresAt = now + SECRET_TTL_SECONDS;

  const secret = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.APPLE_KEY_ID })
    .setIssuer(env.APPLE_TEAM_ID)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setAudience("https://appleid.apple.com")
    .setSubject(env.APPLE_CLIENT_ID)
    .sign(privateKey);

  cached = { secret, expiresAt };
  return secret;
}
