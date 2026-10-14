import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

/**
 * Băm và kiểm tra mật khẩu. MỘT thuật toán duy nhất: Argon2id.
 *
 * ---
 * VÌ SAO ARGON2ID
 *
 * Lựa chọn số một của OWASP hiện nay. Khác biệt cốt lõi so với bcrypt: bcrypt
 * chỉ tốn CPU, còn Argon2id tốn CPU *và* bộ nhớ. Kẻ tấn công dựng dàn GPU/ASIC
 * để dò offline bị chặn bởi băng thông bộ nhớ chứ không phải số nhân — thứ đắt
 * và khó mở rộng hơn nhiều.
 *
 * Dùng `@node-rs/argon2` (Rust, nạp qua N-API) thay vì bản JavaScript thuần:
 * bản JS chạy trên chính luồng của Node, nên vài người đăng nhập đồng thời là
 * cả tiến trình khựng lại. Bản Rust chạy ngoài luồng chính và có sẵn bản dựng
 * cho musl, nên image Alpine không phải biên dịch gì.
 *
 * ---
 * KHÔNG CÓ ĐƯỜNG LUI VỀ BCRYPT — VÀ ĐÓ LÀ CHỦ ĐÍCH
 *
 * Đây là bộ khung khởi tạo dự án MỚI: không có kho mật khẩu cũ nào để tương
 * thích. Giữ thêm một thuật toán "phòng khi cần" là giữ một nhánh mã không ai
 * chạy, không ai test, và là một dependency nữa phải theo dõi lỗ hổng.
 *
 * Hash bcrypt lọt vào database (do nhập dữ liệu từ hệ thống cũ) sẽ khiến
 * `verifyPassword` trả về "sai mật khẩu" — thất bại AN TOÀN, không crash. Nếu
 * dự án của bạn THẬT SỰ phải nhận dữ liệu cũ, cách đúng là:
 *
 *   1. `pnpm add bcryptjs` trong packages/core
 *   2. Trong `verifyPassword`, nhận diện tiền tố `$2` rồi so bằng bcrypt
 *   3. Trả `needsRehash: true` khi đúng — mỗi lần đăng nhập thành công là một
 *      bản ghi được nâng cấp sang Argon2id mà người dùng không phải làm gì
 *   4. Gỡ bcrypt đi sau khi số hash `$2` trong database về 0
 */

/**
 * Mã của thuật toán Argon2id trong `@node-rs/argon2`.
 *
 * Viết thẳng số thay vì import `Algorithm.Argon2id`: đó là ambient const enum,
 * mà `isolatedModules` trong tsconfig cấm truy cập loại enum này.
 */
const ARGON2ID = 2;

/**
 * Tham số theo khuyến nghị OWASP: 19 MiB bộ nhớ, 2 lượt, 1 luồng.
 *
 * Ghi rõ ra đây thay vì dựa vào mặc định của thư viện, vì tham số nằm ngay
 * trong chuỗi hash: đổi tham số là mọi hash cũ bị coi là lỗi thời và được băm
 * lại ở lần đăng nhập kế tiếp. Đó là hành vi mong muốn, nhưng phải cố ý.
 */
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Tiền tố mà một hash "đạt chuẩn hiện tại" phải có. Hash Argon2 tự mang tham
 * số của nó (`$argon2id$v=19$m=19456,t=2,p=1$...`), nên so tiền tố là cách rẻ
 * nhất để biết hash có được sinh bằng đúng cấu hình đang dùng không.
 */
const CURRENT_HASH_PREFIX = `$argon2id$v=19$m=${ARGON2_OPTIONS.memoryCost},t=${ARGON2_OPTIONS.timeCost},p=${ARGON2_OPTIONS.parallelism}$`;

/**
 * Hash dùng cho phép so sánh giả. Tính một lần rồi cache.
 *
 * Không có nó, "email không tồn tại" trả về nhanh hơn hẳn "sai mật khẩu", và
 * kẻ tấn công chỉ cần đo thời gian phản hồi là dò ra email nào đã đăng ký.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= argon2Hash("timing-attack-placeholder", ARGON2_OPTIONS);
  return dummyHashPromise;
}

export type PasswordCheck = {
  valid: boolean;
  /**
   * `true` khi mật khẩu ĐÚNG nhưng hash được sinh bằng THAM SỐ cũ — ví dụ sau
   * khi bạn nâng `memoryCost` để theo kịp phần cứng mới.
   *
   * Nơi gọi nên băm lại và ghi đè: đây là cửa sổ duy nhất còn giữ mật khẩu gốc
   * trong bộ nhớ. Nhờ vậy toàn bộ kho mật khẩu tự nâng cấp dần sau mỗi lần
   * đăng nhập, không cần bắt ai đổi mật khẩu.
   */
  needsRehash: boolean;
};

export const CryptoUtils = {
  hashPassword(password: string): Promise<string> {
    return argon2Hash(password, ARGON2_OPTIONS);
  },

  /**
   * Kiểm tra mật khẩu.
   *
   * KHÔNG BAO GIỜ ném lỗi: một hash rác trong database (hoặc hash thuộc thuật
   * toán khác) phải dẫn tới "sai mật khẩu", chứ không phải lỗi 500 làm lộ ra
   * rằng bản ghi đó có vấn đề.
   */
  async verifyPassword(password: string, passwordHash: string): Promise<PasswordCheck> {
    const valid = await argon2Verify(passwordHash, password).catch(() => false);

    return { valid, needsRehash: valid && !passwordHash.startsWith(CURRENT_HASH_PREFIX) };
  },

  /** Đốt lượng thời gian tương đương một lần kiểm tra thật. */
  async fakeCompare(password: string): Promise<void> {
    await argon2Verify(await getDummyHash(), password).catch(() => false);
  },
};
