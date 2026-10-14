import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type ListAuditLogsInput } from "@/schemas/audit.schema";
import { buildPaginationMeta, toPrismaPage } from "@/schemas/common.schema";
import { logger } from "@/lib/logger";

export type AuditEntry = {
  action: string;
  entity: string;
  entityId?: string | null;
  /** `null` = hệ thống tự làm (cron, webhook). */
  actorId?: string | null;
  actorEmail?: string | null;
  /**
   * Dữ liệu trước & sau khi đổi. Đừng nhét mật khẩu hay token vào đây.
   *
   * Kiểu là `Record<string, unknown>` chứ không phải `Prisma.InputJsonValue`:
   * nơi gọi thường truyền thẳng một DTO, mà DTO là một class nên không có index
   * signature và TypeScript từ chối. Bắt mọi controller phải tự ép kiểu chỉ để
   * ghi được một dòng nhật ký là cái giá sai chỗ — ép ở đây, một lần.
   */
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Nhật ký hành động nhạy cảm.
 *
 * ---
 * VÌ SAO `record()` KHÔNG BAO GIỜ NÉM LỖI
 *
 * Ghi nhật ký là việc PHỤ. Nếu bảng audit đầy đĩa hoặc database chậm, hành vi
 * đúng là mất một dòng nhật ký — không phải làm hỏng thao tác nghiệp vụ mà
 * người dùng vừa thực hiện thành công. Lỗi được ghi lại qua `logger.error` nên
 * không biến mất, chỉ là không chặn ai.
 *
 * ⚠️ Nếu dự án của bạn có yêu cầu pháp lý phải ghi được nhật ký mới cho phép
 * thao tác (ngân hàng, y tế), hãy đổi chỗ này thành ném lỗi và gọi nó TRONG
 * cùng transaction với thao tác nghiệp vụ.
 */
export class AuditService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.auditLog.create({
        data: {
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          actorId: entry.actorId ?? null,
          // Chép email tại thời điểm đó: actor có thể bị xoá sau này, và nhật
          // ký mất danh tính là nhật ký vô dụng.
          actorEmail: entry.actorEmail ?? null,
          // Ép kiểu ở đúng một chỗ. An toàn vì Prisma tự serialize sang JSON,
          // và giá trị không serialize được (hàm, BigInt) sẽ lỗi ngay tại đây —
          // trong một hàm vốn đã nuốt lỗi và không chặn nghiệp vụ.
          metadata: entry.metadata as Prisma.InputJsonValue | undefined,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
        },
      });
    } catch (error) {
      logger.error("Không ghi được nhật ký kiểm toán", error, {
        action: entry.action,
        entity: entry.entity,
      });
    }
  }

  async list(input: ListAuditLogsInput) {
    const where: Prisma.AuditLogWhereInput = {
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.action ? { action: input.action } : {}),
      ...(input.entity ? { entity: input.entity } : {}),
      ...(input.entityId ? { entityId: input.entityId } : {}),
      ...(input.from || input.to
        ? {
            createdAt: {
              ...(input.from ? { gte: input.from } : {}),
              ...(input.to ? { lte: input.to } : {}),
            },
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.db.auditLog.count({ where }),
      this.db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        ...toPrismaPage(input),
      }),
    ]);

    return { items, meta: buildPaginationMeta(total, input) };
  }

  /**
   * Xoá nhật ký cũ hơn `days` ngày.
   *
   * Bảng này chỉ tăng. Giữ bao lâu là quyết định của từng dự án — mặc định 365
   * ngày là mức thường gặp trong các yêu cầu kiểm toán, nhưng hãy đối chiếu với
   * quy định áp dụng cho bạn trước khi đổi.
   */
  async purgeOlderThan(days = 365): Promise<number> {
    const result = await this.db.auditLog.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } },
    });
    return result.count;
  }
}

/**
 * Instance dùng chung cho toàn ứng dụng.
 *
 * Constructor nhận `prisma` làm THAM SỐ MẶC ĐỊNH chứ không import cứng: chỗ
 * gọi không phải đổi gì, mà test vẫn tiêm được database giả thay vì phải mock
 * cả module `@/lib/prisma`.
 */
export const auditService = new AuditService();
