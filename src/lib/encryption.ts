import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Mã hoá đối xứng cho bí mật PHẢI đọc lại được dưới dạng gốc.
 *
 * ---
 * DÙNG CHO CÁI GÌ — VÀ KHÔNG DÙNG CHO CÁI GÌ
 *
 * Dùng cho: khoá TOTP, và sau này là access token của nhà cung cấp OAuth nếu
 * dự án cần gọi API thay mặt người dùng.
 *
 * KHÔNG dùng cho mật khẩu. Mật khẩu phải BĂM (Argon2id, một chiều) — mã hoá
 * nghĩa là tồn tại một cách đọc ngược lại, và với mật khẩu thì bất kỳ cách nào
 * như vậy đều là một cách sai.
 *
 * ---
 * VÌ SAO PHẢI MÃ HOÁ KHOÁ TOTP
 *
 * Khoá TOTP sinh ra được mã hợp lệ. Lưu thô nghĩa là một lần rò database làm
 * 2FA mất tác dụng hoàn toàn — đúng lúc nó cần phát huy tác dụng nhất, vì kẻ
 * tấn công vừa có cả kho dữ liệu. Khoá giải mã nằm ở biến môi trường, tức là
 * NGOÀI database: một bản dump SQL bị lộ không đủ để dựng lại mã.
 *
 * ---
 * AES-256-GCM, KHÔNG PHẢI AES-CBC
 *
 * GCM có xác thực gắn liền (AEAD): sửa một byte trong bản mã là giải mã thất
 * bại, không phải ra một chuỗi rác được coi là hợp lệ. CBC thiếu điều đó và đã
 * đẻ ra cả một họ tấn công padding oracle.
 *
 * Định dạng lưu: `v1.<iv base64url>.<authTag base64url>.<ciphertext base64url>`
 * Có tiền tố phiên bản để sau này đổi thuật toán mà vẫn giải mã được dữ liệu cũ.
 */

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
/** GCM chuẩn dùng nonce 96 bit. */
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;

/**
 * Khoá 32 byte, dẫn xuất từ `ENCRYPTION_KEY`.
 *
 * Dùng SHA-256 để chấp nhận biến môi trường có độ dài bất kỳ. Đây KHÔNG phải
 * key derivation chống dò (như PBKDF2/scrypt) và cũng không cần: giá trị đầu
 * vào là một chuỗi ngẫu nhiên do máy sinh, không phải mật khẩu người nghĩ ra.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  if (!env.ENCRYPTION_KEY) {
    throw new Error(
      "Thiếu ENCRYPTION_KEY — không mã hoá được bí mật (khoá 2FA). " +
        "Sinh bằng: openssl rand -base64 32\n" +
        "⚠️ Đổi giá trị này sau khi đã có dữ liệu là làm hỏng mọi bí mật đã mã hoá: " +
        "người dùng phải cài lại 2FA từ đầu.",
    );
  }

  cachedKey = createHash("sha256").update(env.ENCRYPTION_KEY).digest();
  return cachedKey;
}

/** `true` khi đã cấu hình khoá — dùng để báo tính năng nào bật được. */
export function isEncryptionConfigured(): boolean {
  return Boolean(env.ENCRYPTION_KEY);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Giải mã. Ném lỗi khi bản mã bị sửa, khi khoá sai, hoặc khi định dạng lạ —
 * KHÔNG bao giờ trả về chuỗi rác được coi là hợp lệ.
 */
export function decryptSecret(payload: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split(".");

  if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
    throw new Error("Bản mã không đúng định dạng hoặc thuộc phiên bản không hỗ trợ");
  }

  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
