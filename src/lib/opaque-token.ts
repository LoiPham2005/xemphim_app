import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Token mờ (opaque token): chuỗi ngẫu nhiên không mang thông tin, chỉ có giá
 * trị khi tra được trong database.
 *
 * Dùng cho refresh token và token gửi qua email. Khác JWT ở một điểm quyết
 * định: JWT đã ký thì không thu hồi được, còn token mờ thì xoá dòng trong
 * database là mất hiệu lực NGAY.
 *
 * ---
 * VÌ SAO BĂM SHA-256 CHỨ KHÔNG PHẢI ARGON2
 *
 * Argon2 được thiết kế chậm có chủ đích, để chống dò mật khẩu do con người
 * nghĩ ra — vốn entropy thấp. Token ở đây là 32 byte ngẫu nhiên từ nguồn mã
 * hoá, không gian tìm kiếm 2^256, không có gì để dò. Băm chậm chỉ làm mỗi
 * request tốn thêm thời gian mà không tăng chút an toàn nào.
 *
 * Điều thực sự cần là: database bị rò thì token trong đó không dùng lại được,
 * và tra cứu phải đi qua index. SHA-256 đáp ứng cả hai.
 */

/** 32 byte = 256 bit entropy. */
const TOKEN_BYTES = 32;

/** Chuỗi trả về chỉ tồn tại trong bộ nhớ — không bao giờ lưu nguyên dạng. */
export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Dạng lưu trong database. Luôn băm trước khi ghi VÀ trước khi tra cứu.
 *
 * ⚠️ CHỈ dùng cho token ĐỦ NGẪU NHIÊN (256 bit): refresh token, link trong
 * email. Với giá trị entropy thấp — OTP 6 số, mã khôi phục — phải dùng
 * `hashScopedToken`, xem lý do ở đó.
 */
export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Băm KÈM PHẠM VI, cho giá trị entropy thấp.
 *
 * ---
 * VÌ SAO BẮT BUỘC PHẢI CÓ HÀM NÀY
 *
 * `SHA-256("123456")` là một HẰNG SỐ. Băm OTP bằng `hashOpaqueToken` rồi lưu
 * vào một cột `@unique` dẫn tới hai hỏng hóc, và cái thứ hai là lỗ hổng thật:
 *
 *   1. Hai người cùng bốc trúng `123456` → vi phạm ràng buộc duy nhất, người
 *      thứ hai không xin được mã. Với 10^6 khả năng và vài nghìn mã còn sống,
 *      đây không phải chuyện hiếm (nghịch lý ngày sinh).
 *   2. Tra cứu bằng hash trần sẽ tìm thấy bản ghi của NGƯỜI KHÁC. A nhập đúng
 *      mã của mình, hệ thống trả về `userId` của B — A đăng nhập vào tài khoản
 *      B mà không cần biết gì về B.
 *
 * Thêm `userId` vào phần được băm là hai người cùng mã vẫn cho ra hai hash
 * khác nhau, và không thể tra chéo.
 *
 * ---
 * HỆ QUẢ VỀ CÁCH TRA CỨU
 *
 * Phải BIẾT TRƯỚC người dùng mới tính được hash. Đúng với OTP (người dùng nhập
 * số điện thoại rồi mới nhập mã) và mã khôi phục (đã ở giữa luồng đăng nhập).
 * KHÔNG dùng được cho link trong email, nơi người dùng chỉ gửi lại mỗi token.
 *
 * @param scope Định danh gắn với token — thường là `userId`, kèm loại token.
 */
export function hashScopedToken(scope: string, token: string): string {
  // Dấu phân tách để `scope="ab"+token="c"` không băm ra cùng giá trị với
  // `scope="a"+token="bc"`. Ký tự `\u0000` không xuất hiện trong id hay mã.
  return createHash("sha256").update(`${scope}\u0000${token}`).digest("hex");
}

/**
 * Mã khôi phục 2FA: 10 ký tự Crockford base32, chia hai nhóm — `A1B2C-3D4E5`.
 *
 * Bỏ các ký tự dễ đọc nhầm (I, L, O, U) vì người dùng chép tay từ giấy. 10 ký
 * tự trên bảng 32 ký tự ≈ 50 bit entropy: đủ để không dò được, và mỗi mã chỉ
 * dùng một lần.
 */
const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateRecoveryCode(): string {
  // `randomInt` chứ không phải `Math.random`: đây là bí mật đăng nhập được.
  const chars = Array.from(
    { length: 10 },
    () => RECOVERY_ALPHABET[randomInt(0, RECOVERY_ALPHABET.length)]!,
  );

  return `${chars.slice(0, 5).join("")}-${chars.slice(5).join("")}`;
}

/** Chuẩn hoá mã người dùng gõ vào: bỏ gạch, bỏ khoảng trắng, viết hoa. */
export function normalizeRecoveryCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, "");
}

/**
 * Mã OTP số, mặc định 6 chữ số.
 *
 * Dùng `randomInt` của `node:crypto` chứ KHÔNG dùng `Math.random()`:
 * `Math.random` không phải nguồn ngẫu nhiên mã hoá, trạng thái của nó đoán
 * được từ vài giá trị đầu ra — với một mã chỉ có 10^6 khả năng thì đó là khác
 * biệt giữa "phải dò" và "tính ra được".
 *
 * ⚠️ OTP entropy thấp nên BẮT BUỘC phải kèm giới hạn số lần thử và hạn ngắn
 * (xem `PHONE_OTP_TTL_MINUTES`).
 */
export function generateNumericOtp(digits = 6): string {
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, "0");
}

/**
 * So sánh hai chuỗi băm theo thời gian không đổi.
 *
 * Chỉ cần khi so sánh thủ công. Tra cứu bằng `where: { tokenHash }` không cần
 * hàm này — database đối chiếu qua index, không phải trong mã ứng dụng.
 */
export function safeEqualHash(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");

  // timingSafeEqual ném lỗi khi độ dài khác nhau — mà chính việc ném lỗi đó đã
  // làm lộ thông tin. Chặn trước bằng phép so sánh độ dài, vốn không bí mật.
  if (bufferA.length !== bufferB.length) return false;

  return timingSafeEqual(bufferA, bufferB);
}
