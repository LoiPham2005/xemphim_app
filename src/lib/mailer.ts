import { env, isProduction } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Lớp gửi email.
 *
 * ---
 * BA BẢN CÀI ĐẶT, CHỌN TỰ ĐỘNG
 *
 *   1. Có `SMTP_HOST`  → gửi thật qua SMTP (nodemailer).
 *   2. Không, và đang DEV → ghi nội dung ra log. Lập trình viên lấy được link
 *      xác thực mà không phải dựng máy chủ mail.
 *   3. Không, và đang PRODUCTION → **NÉM LỖI**.
 *
 * Vế cuối là phần quan trọng nhất. Im lặng nuốt email trên production nghĩa là
 * người dùng bấm "quên mật khẩu", hệ thống báo thành công, mà thư không bao giờ
 * tới — và không dòng log nào nói rằng có thứ đã bị bỏ qua.
 *
 * ---
 * DÙNG NHÀ CUNG CẤP KHÁC (Resend / SES / Postmark)
 *
 * Viết một object thoả `Mailer` rồi gọi `setMailer()` lúc khởi động ứng dụng
 * (`apps/api/src/main.ts`). Không cần sửa file này.
 */

export type MailMessage = {
  to: string;
  subject: string;
  /** Nội dung chữ thuần. BẮT BUỘC — mọi trình đọc thư đều hiển thị được. */
  text: string;
  html?: string;
};

export type Mailer = {
  send(message: MailMessage): Promise<void>;
};

/** Ghi ra log ở dev, ném lỗi ở production. */
const consoleMailer: Mailer = {
  // Không khai báo `async`: thân hàm không chờ gì cả.
  send(message) {
    if (isProduction) {
      return Promise.reject(
        new Error(
          "Chưa cấu hình gửi email. Đặt SMTP_HOST trong .env, hoặc gọi setMailer() " +
            "với một nhà cung cấp thật (Resend/SES/Postmark) lúc khởi động ứng dụng.",
        ),
      );
    }

    // Ghi cả phần `text` có chủ đích: link xác thực nằm trong đó, và đó chính
    // là thứ lập trình viên cần lấy ra khi chạy máy cục bộ.
    logger.info("[mailer:dev] Email KHÔNG được gửi thật", {
      from: env.MAIL_FROM ?? "(chưa đặt MAIL_FROM)",
      to: message.to,
      subject: message.subject,
      text: message.text,
    });

    return Promise.resolve();
  },
};

/**
 * Gửi qua SMTP. `nodemailer` được nạp động để dự án không dùng email không
 * phải mang thư viện này vào bộ nhớ.
 */
function createSmtpMailer(host: string): Mailer {
  let transportPromise: Promise<{ sendMail(options: unknown): Promise<unknown> }> | null = null;

  async function getTransport() {
    transportPromise ??= (async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport({
        host,
        port: env.SMTP_PORT,
        // `secure: true` = TLS ngay từ đầu (cổng 465). Cổng 587 dùng STARTTLS
        // nên phải để false — đặt sai là kết nối treo cho tới khi timeout.
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      });

      logger.info("Mailer: dùng SMTP", { host, port: env.SMTP_PORT });
      return transport;
    })();

    return transportPromise;
  }

  return {
    async send(message) {
      const transport = await getTransport();
      await transport.sendMail({
        from: env.MAIL_FROM ?? env.SMTP_USER,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}

let currentMailer: Mailer | null = null;

/** Cắm nhà cung cấp thật. Gọi một lần lúc khởi động ứng dụng. */
export function setMailer(mailer: Mailer): void {
  currentMailer = mailer;
}

export function getMailer(): Mailer {
  currentMailer ??= env.SMTP_HOST ? createSmtpMailer(env.SMTP_HOST) : consoleMailer;
  return currentMailer;
}

/** `true` khi email thật sự được gửi đi (không phải chỉ ghi log). */
export function isMailerConfigured(): boolean {
  return Boolean(env.SMTP_HOST) || currentMailer !== null;
}
