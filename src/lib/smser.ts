import { env, isProduction } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Lớp gửi SMS.
 *
 * ---
 * VÌ SAO TÁCH KHỎI `mailer` DÙ HAI CÁI GIỐNG HỆT NHAU VỀ HÌNH DẠNG
 *
 * Vì chúng khác nhau ở thứ quan trọng nhất: **SMS tốn tiền thật, email thì
 * không**. Một lỗi làm gửi thừa 10.000 email là phiền; 10.000 SMS là một hoá
 * đơn. Toàn bộ phần chống lạm dụng ở `AuthService.requestPhoneVerification`
 * tồn tại vì lý do đó, và nó không có bản tương ứng bên email.
 *
 * ---
 * MẶC ĐỊNH: TẮT
 *
 *   • Chưa cắm nhà cung cấp + DEV → ghi mã ra log. Lập trình viên thử được
 *     luồng mà không tốn một đồng nào.
 *   • Chưa cắm + PRODUCTION → **NÉM LỖI**. Im lặng nuốt SMS nghĩa là người
 *     dùng bấm "gửi mã", thấy báo thành công, rồi đợi mãi một tin không tồn tại.
 *
 * Nghĩa là tính năng này có sẵn mà không tốn gì cho tới khi bạn thật sự cắm
 * nhà cung cấp vào.
 *
 * ---
 * CẮM NHÀ CUNG CẤP THẬT
 *
 * Mỗi dự án Việt Nam dùng một bên khác nhau (eSMS, Viettel, VNPT, Twilio), nên
 * bộ khung cố ý không chọn hộ. Viết một object thoả `Smser` rồi gọi
 * `setSmser()` trong `apps/api/src/main.ts`:
 *
 *   setSmser({
 *     async send({ to, text }) {
 *       await fetch("https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_get", …);
 *     },
 *   });
 */

export type SmsMessage = {
  /** Số điện thoại đã chuẩn hoá (0xxxxxxxxx hoặc +84xxxxxxxxx). */
  to: string;
  text: string;
};

export type Smser = {
  send(message: SmsMessage): Promise<void>;
};

const consoleSmser: Smser = {
  send(message) {
    if (isProduction) {
      return Promise.reject(
        new Error(
          "Chưa cấu hình gửi SMS. Gọi setSmser() với nhà cung cấp thật (eSMS/Viettel/Twilio) " +
            "lúc khởi động ứng dụng, hoặc tắt luồng xác thực số điện thoại.",
        ),
      );
    }

    // Ghi cả nội dung có chủ đích: mã OTP nằm trong đó, và đó chính là thứ lập
    // trình viên cần lấy ra khi chạy máy cục bộ.
    logger.info("[sms:dev] SMS KHÔNG được gửi thật", { to: message.to, text: message.text });

    return Promise.resolve();
  },
};

let currentSmser: Smser | null = null;

/** Cắm nhà cung cấp thật. Gọi một lần lúc khởi động ứng dụng. */
export function setSmser(smser: Smser): void {
  currentSmser = smser;
}

export function getSmser(): Smser {
  return currentSmser ?? consoleSmser;
}

/** `true` khi SMS thật sự được gửi đi (không phải chỉ ghi log). */
export function isSmserConfigured(): boolean {
  return currentSmser !== null;
}

/** `true` khi luồng xác thực số điện thoại được bật. */
export function isPhoneVerificationEnabled(): boolean {
  return env.PHONE_VERIFICATION_ENABLED;
}
