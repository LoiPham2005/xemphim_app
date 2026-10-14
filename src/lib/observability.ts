// Không import `./env`: file này chạy cả trong client component (error.tsx,
// global-error.tsx), nơi trình duyệt không có secret nên `env` sẽ ném lỗi.
// `process.env.NODE_ENV` thì Next tự thay giá trị vào bundle client.
const isProduction = process.env.NODE_ENV === "production";

/**
 * Điểm nối để đẩy lỗi ra hệ thống giám sát bên ngoài (Sentry, GlitchTip,
 * OpenTelemetry…).
 *
 * ---
 * VÌ SAO KHÔNG CẮM SẴN SENTRY
 *
 * Cùng lý do với `src/lib/mailer.ts`: đây là bộ khung dùng cho nhiều dự án, và
 * mỗi dự án bị ràng buộc khác nhau — có nơi đã mua Sentry, có nơi tự dựng
 * GlitchTip, có nơi khách yêu cầu dữ liệu không rời khỏi Việt Nam. Cắm cứng
 * một nhà cung cấp vào đây chỉ tạo ra việc phải¬ gỡ ra, cộng thêm một
 * dependency nặng mà phần lớn dự án không dùng.
 *¬
 * Thay vào đó: một interface hẹp, và một bản mặc định không làm gì cả.
 *
 * ---
 * VÌ SAO BẢN MẶC ĐỊNH IM LẶNG (khác hẳn mailer)
 *
 * `mailer` mặc định NÉM LỖI trên production, vì im lặng nuốt email là hành vi
 * nguy hiểm — người dùng bấm "quên mật khẩu" mà thư không tới.
 *
 * Ở đây thì ngược lại. Lỗi đã được ghi vào log JSON của ứng dụng rồi
 * (`src/lib/logger.ts`), nên không có gì bị mất. Việc chưa cắm Sentry chỉ
 * nghĩa là bạn phải đọc log thủ công — bất tiện, không phải mất dữ liệu. Và
 * không hệ thống nào nên sập chỉ vì dịch vụ giám sát của nó chết.
 *
 * ---
 * CẮM NHÀ CUNG CẤP THẬT
 *
 * Viết một object thoả `ErrorReporter` rồi gọi `setErrorReporter()` ở nơi khởi
 * động. Ví dụ với Sentry:
 *
 *   import * as Sentry from "@sentry/nextjs";
 *
 *   setErrorReporter({
 *     captureException(error, context) {
 *       Sentry.captureException(error, { extra: context });
 *     },
 *     setUser(user) {
 *       Sentry.setUser(user);
 *     },
 *   });
 */

export type ErrorContext = Record<string, unknown>;

export type ErrorReporter = {
  captureException(error: unknown, context?: ErrorContext): void;
  /**
   * Gắn danh tính người dùng vào các lỗi tiếp theo.
   *
   * ⚠️ CHỈ truyền id và email. Đừng gửi tên, số điện thoại hay bất cứ dữ liệu
   * cá nhân nào khác sang dịch vụ bên thứ ba — đó là dữ liệu của khách hàng
   * bạn, không phải của bạn.
   */
  setUser?(user: { id: string; email?: string } | null): void;
};

const noopReporter: ErrorReporter = {
  captureException() {
    // Cố ý không làm gì. Lỗi đã nằm trong log ứng dụng.
  },
};

let currentReporter: ErrorReporter = noopReporter;

/** Cắm nhà cung cấp thật. Gọi một lần lúc khởi động ứng dụng. */
export function setErrorReporter(reporter: ErrorReporter): void {
  currentReporter = reporter;
}

/**
 * Đẩy một lỗi ra hệ thống giám sát.
 *
 * KHÔNG BAO GIỜ ném lỗi ra ngoài — kể cả khi chính reporter hỏng. Một dịch vụ
 * giám sát chết không được phép kéo theo ứng dụng.
 */
export function captureException(error: unknown, context?: ErrorContext): void {
  try {
    currentReporter.captureException(error, context);
  } catch {
    // Không dùng `logger` ở đây: logger là thứ GỌI hàm này (xem logger.error),
    // nên gọi ngược lại là tạo vòng lặp vô hạn khi cả hai cùng hỏng.
    if (!isProduction) {
      console.error("[observability] reporter ném lỗi, đã bỏ qua");
    }
  }
}

export function setUser(user: { id: string; email?: string } | null): void {
  try {
    currentReporter.setUser?.(user);
  } catch {
    // Cùng lý do trên.
  }
}
