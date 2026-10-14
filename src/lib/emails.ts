import { appUrl, env } from "@/lib/env";
import { enqueue } from "@/lib/queue";

/**
 * Nội dung các email hệ thống.
 *
 * Mọi email đi qua HÀNG ĐỢI, không gửi thẳng: SMTP có thể mất vài giây, và
 * người dùng bấm "quên mật khẩu" không nên ngồi chờ chừng ấy chỉ để nhận về
 * một trang xác nhận. Quan trọng hơn — hàng đợi có THỬ LẠI: nhà cung cấp thư
 * nghẽn một lúc thì job tự chạy lại, thay vì lá thư biến mất vĩnh viễn.
 *
 * Tách khỏi service để chữ nghĩa sửa được mà không đụng vào logic, và để service
 * không phải biết gì về đường dẫn hay cách dựng link.
 */

/**
 * Đường dẫn TRÊN WEB (không phải trên API) mà người dùng sẽ mở từ email.
 *
 * Đổi tên route ở `apps/web` thì sửa ở đây — nếu không, link trong email trỏ
 * vào trang 404, và lỗi đó chỉ lộ ra khi có người thật bấm vào.
 */
const WEB_ROUTES = {
  verifyEmail: "/verify-email",
  resetPassword: "/reset-password",
  confirmEmailChange: "/confirm-email-change",
} as const;

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const link = appUrl(`${WEB_ROUTES.verifyEmail}?token=${encodeURIComponent(token)}`);

  await enqueue("email:send", {
    to,
    subject: "Xác thực địa chỉ email của bạn",
    text: [
      "Chào bạn,",
      "",
      "Nhấn vào liên kết dưới đây để xác thực địa chỉ email này:",
      link,
      "",
      `Liên kết có hiệu lực trong ${env.EMAIL_VERIFICATION_TTL_HOURS} giờ.`,
      "",
      "Nếu bạn không tạo tài khoản nào, hãy bỏ qua email này.",
    ].join("\n"),
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = appUrl(`${WEB_ROUTES.resetPassword}?token=${encodeURIComponent(token)}`);

  await enqueue("email:send", {
    to,
    subject: "Đặt lại mật khẩu",
    text: [
      "Chào bạn,",
      "",
      "Có yêu cầu đặt lại mật khẩu cho tài khoản này. Nhấn vào liên kết dưới đây:",
      link,
      "",
      `Liên kết có hiệu lực trong ${env.PASSWORD_RESET_TTL_MINUTES} phút và chỉ dùng được một lần.`,
      "",
      // Câu này quan trọng hơn vẻ ngoài của nó: người nhận nhầm cần biết họ
      // không phải làm gì cả, và mật khẩu hiện tại vẫn còn nguyên hiệu lực.
      "Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu của bạn không thay đổi.",
    ].join("\n"),
  });
}

/**
 * Báo cho người dùng biết mật khẩu vừa bị đổi.
 *
 * Không phải thư xã giao: nếu tài khoản đã bị chiếm, đây là tín hiệu duy nhất
 * mà chủ tài khoản thật nhận được. Gửi SAU KHI đổi thành công, tới địa chỉ CŨ.
 */
export async function sendPasswordChangedEmail(to: string): Promise<void> {
  await enqueue("email:send", {
    to,
    subject: "Mật khẩu của bạn vừa được thay đổi",
    text: [
      "Chào bạn,",
      "",
      "Mật khẩu tài khoản của bạn vừa được thay đổi, và mọi thiết bị đang đăng nhập đã bị đăng xuất.",
      "",
      "Nếu KHÔNG phải bạn thực hiện, hãy đặt lại mật khẩu ngay và liên hệ quản trị viên.",
    ].join("\n"),
  });
}

/**
 * Xác thực địa chỉ email MỚI trong luồng đổi email.
 *
 * Gửi tới địa chỉ MỚI — nó phải tự chứng minh quyền sở hữu trước khi thay thế
 * địa chỉ cũ.
 */
export async function sendEmailChangeVerificationEmail(to: string, token: string): Promise<void> {
  const link = appUrl(`${WEB_ROUTES.confirmEmailChange}?token=${encodeURIComponent(token)}`);

  await enqueue("email:send", {
    to,
    subject: "Xác nhận địa chỉ email mới",
    text: [
      "Chào bạn,",
      "",
      "Có yêu cầu chuyển tài khoản sang dùng địa chỉ email này. Nhấn vào liên kết dưới đây để xác nhận:",
      link,
      "",
      `Liên kết có hiệu lực trong ${env.EMAIL_VERIFICATION_TTL_HOURS} giờ.`,
      "",
      "Nếu bạn không yêu cầu, hãy bỏ qua email này — sẽ không có gì thay đổi.",
    ].join("\n"),
  });
}

/**
 * Báo cho địa chỉ CŨ biết có người đang xin đổi email.
 *
 * Đây là phần quan trọng nhất của luồng đổi email, không phải thư xã giao:
 * nếu tài khoản đã bị chiếm, đây là tín hiệu DUY NHẤT mà chủ thật nhận được
 * trước khi mất quyền khôi phục tài khoản. Vì vậy nó gửi NGAY ở bước xin đổi,
 * không đợi tới lúc xác nhận.
 */
export async function sendEmailChangeNoticeEmail(to: string, newEmail: string): Promise<void> {
  // Che phần giữa của địa chỉ mới: đủ để chủ thật nhận ra "đúng là tôi vừa
  // làm" hay không, mà không tiết lộ nguyên địa chỉ của kẻ tấn công cho một
  // hộp thư có thể đã bị đọc trộm.
  const [local = "", domain = ""] = newEmail.split("@");
  const masked = `${local.slice(0, 2)}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;

  await enqueue("email:send", {
    to,
    subject: "Cảnh báo: có yêu cầu đổi địa chỉ email của tài khoản",
    text: [
      "Chào bạn,",
      "",
      `Có yêu cầu chuyển tài khoản này sang địa chỉ ${masked}.`,
      "",
      "Nếu ĐÚNG là bạn: không cần làm gì ở đây — hãy mở hộp thư mới và bấm liên kết xác nhận.",
      "",
      "Nếu KHÔNG phải bạn: tài khoản của bạn có thể đã bị chiếm. Hãy đổi mật khẩu NGAY",
      "và đăng xuất toàn bộ thiết bị trong phần quản lý phiên đăng nhập.",
    ].join("\n"),
  });
}
