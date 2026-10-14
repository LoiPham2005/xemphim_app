import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tokenService } from "@/services/token.service";
import { verificationService } from "@/services/verification.service";
import { auditService } from "@/services/audit.service";
import { fileService } from "@/services/file.service";

/**
 * Dọn token đã hết hạn hoặc đã dùng.
 *
 * ---
 * VÌ SAO CẦN CHẠY ĐỊNH KỲ
 *
 * `refresh_tokens` và `verification_tokens` là hai bảng CHỈ TĂNG. Mỗi lần đăng
 * nhập trên điện thoại là một dòng refresh token; mỗi lần ai đó bấm "quên mật
 * khẩu" là một dòng verification token — kể cả khi họ không bao giờ mở email.
 * Không có gì tự xoá chúng.
 *
 * Cả hai service đều đã có sẵn `purgeExpired()` kèm ghi chú "gọi định kỳ bằng
 * cron", nhưng trước file này KHÔNG có cron nào gọi cả. Hai bảng cứ phình ra,
 * và thứ hỏng trước tiên là chính truy vấn tra token lúc đăng nhập.
 *
 * ---
 * CÁCH CHẠY
 *
 *   pnpm db:purge
 *
 * Trên máy chủ, gọi nó theo lịch — xem `deploy/xemphim-purge.timer`
 * (systemd) hoặc mục cron trong README.
 *
 * An toàn khi chạy nhiều lần và chạy song song: cả hai truy vấn đều là
 * `deleteMany` theo điều kiện thời gian, không có bước đọc-rồi-ghi nào để mà
 * tranh nhau.
 */
async function main() {
  const startedAt = Date.now();

  // Chạy tuần tự chứ không song song: hai lệnh DELETE cùng lúc trên cùng một
  // connection pool nhỏ chỉ làm chậm nhau, mà đây là tác vụ nền không ai đợi.
  const refreshTokens = await tokenService.purgeExpired();
  const verificationTokens = await verificationService.purgeExpired();

  /*
   * Nhật ký thao tác cũng là bảng chỉ tăng, nhưng giữ LÂU HƠN token rất nhiều.
   *
   * 90 ngày là con số cho vận hành: đủ để điều tra "tháng trước ai đổi phân
   * quyền". Nếu bạn có yêu cầu tuân thủ (kế toán, y tế, tài chính) thì con số
   * này phải do quy định quyết định, có thể là nhiều năm — và đừng bao giờ hạ
   * nó xuống chỉ vì database đang đầy.
   */
  const auditDays = Number(process.env.AUDIT_RETENTION_DAYS ?? 90);
  const auditLogs = await auditService.purgeOlderThan(auditDays);

  // Tệp tải lên rồi bỏ ngang (không gắn vào bản ghi nào quá 24h) — xoá cả trên kho lẫn database.
  const orphanFiles = await fileService.purgeOrphans();

  logger.info("Dọn dữ liệu hết hạn xong", {
    refreshTokens,
    verificationTokens,
    auditLogs,
    auditRetentionDays: auditDays,
    orphanFiles,
    durationMs: Date.now() - startedAt,
  });
}

main()
  .catch((error: unknown) => {
    logger.error("Dọn token hết hạn thất bại", error);
    // Thoát khác 0 để cron/systemd ghi nhận là chạy hỏng. Im lặng thất bại thì
    // bảng vẫn phình mà không ai biết.
    process.exitCode = 1;
  })
  .finally(() => {
    // Script ngắn hạn phải tự đóng kết nối, nếu không tiến trình treo cho tới
    // khi pool tự hết hạn — với cron thì đó là một tiến trình zombie mỗi lần chạy.
    void prisma.$disconnect();
  });
