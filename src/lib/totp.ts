import { Secret, TOTP } from "otpauth";

/**
 * Mã một lần theo thời gian (TOTP, RFC 6238) — chuẩn mà Google Authenticator,
 * Authy, 1Password và mọi app xác thực khác đều nói.
 *
 * ---
 * VÌ SAO DÙNG THƯ VIỆN CHỨ KHÔNG TỰ VIẾT
 *
 * TOTP nhìn thì đơn giản (HMAC-SHA1 + cắt động), nhưng ba chỗ rất dễ sai và
 * sai thì im lặng: giải mã base32 (bảng chữ cái, padding), phép cắt động
 * (dynamic truncation) khi bit cao là 1, và cửa sổ thời gian. `otpauth` chỉ
 * phụ thuộc `@noble/hashes` — thư viện mã hoá đã được kiểm toán độc lập.
 *
 * ---
 * THAM SỐ: 6 SỐ / 30 GIÂY / SHA-1
 *
 * Nhìn có vẻ yếu, nhưng đây là mặc định BẮT BUỘC nếu muốn tương thích: rất
 * nhiều app xác thực bỏ qua tham số trong URI và luôn giả định bộ này. Đổi
 * sang SHA-256 hoặc 8 chữ số là một phần người dùng nhận mã không bao giờ
 * khớp — và không có cách nào báo cho họ biết vì sao.
 *
 * SHA-1 ở đây KHÔNG phải vấn đề: điểm yếu của SHA-1 là va chạm, còn HMAC-SHA1
 * vẫn an toàn, và bí mật thì chỉ sống 30 giây.
 */

const DIGITS = 6;
const PERIOD_SECONDS = 30;
const ALGORITHM = "SHA1";

/**
 * Chấp nhận lệch 1 bước (±30 giây).
 *
 * Đồng hồ điện thoại lệch vài giây là chuyện thường, và người dùng cũng cần
 * thời gian gõ. Cửa sổ 1 nghĩa là 3 mã hợp lệ tại mỗi thời điểm — vẫn chỉ là
 * 3/10^6, không đáng kể. Nới lên 2-3 để "cho dễ" là nhân số mã hợp lệ lên mà
 * không giải quyết vấn đề thật (đồng hồ lệch hẳn vài phút).
 */
const VALIDATION_WINDOW = 1;

export type TotpSetup = {
  /** Bí mật dạng base32 — thứ phải được mã hoá trước khi ghi vào database. */
  secret: string;
  /** URI `otpauth://` để dựng mã QR. Chứa bí mật, đừng ghi vào log. */
  uri: string;
};

/**
 * Sinh bí mật mới cho một người dùng.
 *
 * @param issuer Tên hiển thị trong app xác thực. Nên là tên sản phẩm.
 * @param label Định danh tài khoản trong app — email hoặc tên đăng nhập.
 */
export function createTotpSecret(issuer: string, label: string): TotpSetup {
  // 20 byte = 160 bit, đúng độ dài khoá mà RFC 4226 khuyến nghị cho HMAC-SHA1.
  const secret = new Secret({ size: 20 });

  const totp = new TOTP({
    issuer,
    label,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret,
  });

  return { secret: secret.base32, uri: totp.toString() };
}

/**
 * Kiểm tra mã người dùng nhập.
 *
 * Trả về `null` khi sai, hoặc số bước lệch khi đúng (0 = đúng cửa sổ hiện tại).
 * Nơi gọi chỉ cần biết đúng/sai; giá trị lệch dùng để phát hiện phát lại mã.
 *
 * KHÔNG BAO GIỜ ném lỗi: bí mật hỏng trong database phải dẫn tới "mã sai", chứ
 * không phải lỗi 500 làm lộ ra rằng bản ghi đó có vấn đề.
 */
export function verifyTotp(secretBase32: string, code: string): number | null {
  try {
    const totp = new TOTP({
      algorithm: ALGORITHM,
      digits: DIGITS,
      period: PERIOD_SECONDS,
      secret: Secret.fromBase32(secretBase32),
    });

    // Người dùng hay chép cả khoảng trắng từ app xác thực.
    const delta = totp.validate({ token: code.replace(/\s/g, ""), window: VALIDATION_WINDOW });

    return delta === null ? null : delta;
  } catch {
    return null;
  }
}
