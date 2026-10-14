import { env } from "@/lib/env";
import { enqueue } from "@/lib/queue";

/**
 * Nội dung các tin nhắn hệ thống.
 *
 * Đi qua HÀNG ĐỢI như email: nhà cung cấp SMS hay nghẽn vài giây, và người dùng
 * bấm "gửi mã" không nên ngồi chờ chừng ấy.
 *
 * ⚠️ Nhưng khác email ở một điểm: job SMS **không nên thử lại vô tội vạ**. Mỗi
 * lần thử là một tin nhắn tính phí. Cấu hình `attempts` mặc định của hàng đợi
 * là 3 — chấp nhận được vì lỗi thường xảy ra TRƯỚC khi tin được gửi (mất mạng,
 * sai chữ ký). Nếu nhà cung cấp của bạn tính phí ngay cả khi trả lỗi, hãy hạ
 * `attempts` xuống 1 cho riêng loại job này.
 */
export async function sendPhoneOtpSms(to: string, code: string): Promise<void> {
  await enqueue("sms:send", {
    to,
    // Ngắn gọn có lý do: SMS tính phí theo đoạn 160 ký tự (70 nếu có dấu tiếng
    // Việt). Một câu dài lịch sự có thể nhân đôi hoá đơn.
    text: `${code} la ma xac thuc cua ban. Hieu luc ${env.PHONE_OTP_TTL_MINUTES} phut. Khong chia se ma nay cho bat ky ai.`,
  });
}
