import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getMailer } from "@/lib/mailer";
import { getSmser } from "@/lib/smser";
import { TokenService } from "@/services/token.service";
import { VerificationService } from "@/services/verification.service";
import { AuditService } from "@/services/audit.service";
import { DeviceService } from "@/services/device.service";
import type { JobHandlers } from "@/jobs/types";

/**
 * Nơi job thật sự được xử lý.
 *
 * Cùng một object được dùng ở HAI chỗ: `apps/worker` (đường đi thật) và
 * `infra/queue.ts` khi hàng đợi bị tắt (chạy thẳng trong request). Một bản cài
 * đặt duy nhất nghĩa là hai chế độ không thể lệch hành vi.
 *
 * ---
 * HANDLER PHẢI CHẠY LẠI ĐƯỢC MÀ KHÔNG GÂY HẠI (idempotent)
 *
 * BullMQ thử lại khi thất bại, và một job có thể chạy hai lần nếu worker chết
 * đúng lúc vừa xong việc nhưng chưa kịp báo. Handler nào có tác dụng phụ không
 * chịu được lặp (trừ tiền, gửi tin nhắn tính phí) thì phải tự chốt bằng một
 * khoá trong database.
 */
export const jobHandlers: JobHandlers = {
  async "email:send"(payload) {
    await getMailer().send(payload);
    logger.info("Đã gửi email", { to: payload.to, subject: payload.subject });
  },

  async "sms:send"(payload) {
    await getSmser().send(payload);
    // KHÔNG ghi nội dung vào log: mã OTP nằm trong đó, và log thường được giữ
    // nhiều tháng ở một dịch vụ bên thứ ba.
    logger.info("Đã gửi SMS", { to: payload.to });
  },

  async "push:send"(payload) {
    const devices = await prisma.userDevice.findMany({
      where: { userId: { in: payload.userIds }, isActive: true },
      select: { fcmToken: true },
    });

    if (devices.length === 0) {
      logger.debug("Không có thiết bị nào để đẩy push", { notificationId: payload.notificationId });
      return;
    }

    /*
     * ĐIỂM CẮM FIREBASE.
     *
     * Cố ý chưa cài sẵn `firebase-admin`: nó cần service account riêng của từng
     * dự án, và là một dependency nặng mà phần lớn dự án web không dùng. Khi
     * cần, cài `firebase-admin` rồi thay khối này bằng:
     *
     *   await getMessaging().sendEachForMulticast({
     *     tokens, notification: { title, body }, data,
     *   });
     *
     * Nhớ xoá token bị Firebase trả về `UNREGISTERED` — xem `DeviceService`.
     */
    logger.info("Push (chưa cắm Firebase — mới ghi log)", {
      notificationId: payload.notificationId,
      deviceCount: devices.length,
    });

    await prisma.notificationRecipient.updateMany({
      where: { notificationId: payload.notificationId, userId: { in: payload.userIds } },
      data: { isPushed: true, pushedAt: new Date() },
    });
  },

  /**
   * Dọn MỌI bảng chỉ-tăng, chạy hằng ngày (xem `PURGE_CRON`).
   *
   * Bốn bảng dưới đây không bao giờ tự nhỏ đi: mỗi lần đăng nhập, mỗi lần bấm
   * "quên mật khẩu", mỗi hành động nhạy cảm, mỗi lần mở app đều thêm một dòng.
   * Thiếu job này thì chúng lớn âm thầm cho tới ngày truy vấn bắt đầu chậm —
   * và lúc đó không ai nghĩ tới đây.
   *
   * Chạy TUẦN TỰ chứ không `Promise.all`: đây là bốn lệnh `DELETE` trên bảng
   * lớn, chạy song song là bốn lần khoá dòng cùng lúc vào 3 giờ sáng.
   */
  async "maintenance:purge-expired"() {
    const refreshTokens = await new TokenService(prisma).purgeExpired();
    const verificationTokens = await new VerificationService(prisma).purgeExpired();
    const auditLogs = await new AuditService(prisma).purgeOlderThan(env.AUDIT_RETENTION_DAYS);
    const staleDevices = await new DeviceService(prisma).purgeStale(env.DEVICE_STALE_DAYS);

    logger.info("Đã dọn dữ liệu hết hạn", {
      refreshTokens,
      verificationTokens,
      auditLogs,
      staleDevices,
    });
  },
};
