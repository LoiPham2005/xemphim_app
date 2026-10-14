import type { MailMessage } from "@/lib/mailer";
import type { SmsMessage } from "@/lib/smser";

/**
 * Danh mục job và hình dạng payload của từng loại.
 *
 * ---
 * VÌ SAO Ở TRONG `packages/core`, KHÔNG PHẢI TRONG `apps/worker`
 *
 * File này được import từ HAI phía: `apps/api` (bên đẩy job vào hàng đợi) và
 * `apps/worker` (bên lấy ra chạy). Đặt ở tầng dùng chung để cả hai nhìn chung
 * một định nghĩa — nhờ vậy TypeScript bắt được ngay khi hai bên lệch nhau về
 * payload. Không có bước này thì lỗi lệch payload chỉ lộ ra lúc chạy, và lộ ở
 * tiến trình worker — nơi không ai đang nhìn.
 *
 * ---
 * PAYLOAD PHẢI SERIALIZE ĐƯỢC BẰNG JSON
 *
 * Job đi qua Redis dưới dạng chuỗi JSON: `Date`, `Map`, `class` và hàm đều
 * KHÔNG sống sót. Dùng `string` cho thời điểm (ISO 8601).
 *
 * ---
 * ĐỪNG NHÉT DỮ LIỆU LỚN VÀO PAYLOAD
 *
 * Payload nằm trong Redis, tức là trong RAM. Truyền `id` rồi để worker tự đọc
 * database. Ngoại lệ hợp lý: nội dung email dưới đây — nó cần đúng nội dung
 * tại thời điểm gửi, đọc lại từ database sau đó có thể ra kết quả khác.
 */
export type JobPayloads = {
  /** Gửi một email. Lý do phổ biến nhất để cần hàng đợi. */
  "email:send": MailMessage;

  /**
   * Gửi một SMS.
   *
   * ⚠️ Mỗi lần chạy lại là một tin nhắn TÍNH PHÍ. Hàng đợi thử lại 3 lần —
   * chấp nhận được vì lỗi thường xảy ra TRƯỚC khi tin được gửi. Nếu nhà cung
   * cấp của bạn tính phí cả khi trả lỗi, hạ `attempts` xuống 1 cho loại này.
   */
  "sms:send": SmsMessage;

  /** Đẩy push notification tới thiết bị của một danh sách người dùng. */
  "push:send": {
    notificationId: string;
    userIds: string[];
  };

  /**
   * Dọn token đã hết hạn. Chạy theo lịch (`apps/worker` đăng ký repeatable job)
   * — bảng token chỉ tăng: mỗi lần đăng nhập, mỗi lần bấm "quên mật khẩu" là
   * thêm một dòng.
   */
  "maintenance:purge-expired": Record<string, never>;
};

export type JobName = keyof JobPayloads;

/** Hàm xử lý một loại job. Không trả gì — job xong là xong. */
export type JobHandler<TName extends JobName> = (payload: JobPayloads[TName]) => Promise<void>;

export type JobHandlers = { [TName in JobName]: JobHandler<TName> };
