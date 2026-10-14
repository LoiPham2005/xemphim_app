import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildPaginationMeta, toPrismaPage } from "@/schemas/common.schema";
import {
  type ListNotificationsInput,
  type SendNotificationInput,
} from "@/schemas/notification.schema";
import { enqueue } from "@/lib/queue";

/**
 * Thông báo trong ứng dụng (+ đẩy push qua job nền).
 *
 * ---
 * VÌ SAO TÁCH `Notification` VÀ `NotificationRecipient`
 *
 * Nội dung lưu MỘT bản duy nhất dù gửi cho một triệu người; chỉ trạng thái
 * đọc/đã đẩy là nhân theo người nhận. Gộp làm một bảng thì mỗi lần gửi
 * broadcast là chép nguyên tiêu đề + nội dung + ảnh cho từng người — dung
 * lượng tăng theo tích số, và sửa một lỗi chính tả trong thông báo đã gửi là
 * bất khả thi.
 */
/**
 * Một dòng trong hộp thông báo.
 *
 * Khai báo tường minh thay vì để TypeScript suy ra từ `select` của Prisma: kiểu
 * suy ra cho cột `Json` tham chiếu tới nội bộ runtime của Prisma, và một kiểu
 * như vậy không "gọi tên" được khi sinh file `.d.ts` — tsc báo TS2742. Viết ra
 * đây cũng khiến hợp đồng với client trở nên rõ ràng.
 */
export type NotificationItem = {
  /** Id của bản ghi NGƯỜI NHẬN — đây mới là thứ truyền vào `markRead`. */
  recipientId: string;
  /** Id của nội dung thông báo, dùng chung cho mọi người nhận. */
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  actionUrl: string | null;
  type: "DIRECT" | "TOPIC" | "BROADCAST";
  data: unknown;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
};

export class NotificationService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Tạo thông báo và giao cho người nhận.
   *
   * `BROADCAST` lấy toàn bộ user đang hoạt động. Với hệ thống lớn thì việc
   * chèn hàng triệu dòng nên chuyển hẳn sang job nền — ở đây làm thẳng vì bộ
   * khung không giả định quy mô, nhưng `createMany` đã đủ để tránh N truy vấn.
   */
  async send(input: SendNotificationInput, senderId?: string | null) {
    const userIds =
      input.type === "BROADCAST"
        ? (
            await this.db.user.findMany({
              where: { status: "ACTIVE", deletedAt: null },
              select: { id: true },
            })
          ).map((user) => user.id)
        : (input.userIds ?? []);

    const notification = await this.db.notification.create({
      data: {
        title: input.title,
        body: input.body,
        imageUrl: input.imageUrl ?? null,
        actionUrl: input.actionUrl ?? null,
        type: input.type,
        data: input.data as never,
        senderId: senderId ?? null,
        recipients: {
          createMany: {
            data: userIds.map((userId) => ({ userId })),
            // Cùng một người xuất hiện hai lần trong `userIds` là lỗi của bên
            // gọi, không phải lý do để cả thao tác thất bại.
            skipDuplicates: true,
          },
        },
      },
      select: { id: true, createdAt: true },
    });

    // Push đi qua hàng đợi: gửi FCM cho hàng nghìn thiết bị có thể mất vài
    // chục giây, và người bấm "Gửi" không nên ngồi chờ chừng ấy.
    if (userIds.length > 0) {
      await enqueue("push:send", { notificationId: notification.id, userIds });
    }

    return {
      id: notification.id,
      recipientCount: userIds.length,
      createdAt: notification.createdAt,
    };
  }

  async listForUser(
    userId: string,
    input: ListNotificationsInput,
  ): Promise<{
    items: NotificationItem[];
    meta: ReturnType<typeof buildPaginationMeta> & { unreadCount: number };
  }> {
    const where = { userId, ...(input.unreadOnly ? { isRead: false } : {}) };

    const [total, rows, unreadCount] = await Promise.all([
      this.db.notificationRecipient.count({ where }),
      this.db.notificationRecipient.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          isRead: true,
          readAt: true,
          createdAt: true,
          notification: {
            select: {
              id: true,
              title: true,
              body: true,
              imageUrl: true,
              actionUrl: true,
              type: true,
              data: true,
              createdAt: true,
            },
          },
        },
        ...toPrismaPage(input),
      }),
      this.db.notificationRecipient.count({ where: { userId, isRead: false } }),
    ]);

    return {
      items: rows.map((row) => ({
        recipientId: row.id,
        id: row.notification.id,
        title: row.notification.title,
        body: row.notification.body,
        imageUrl: row.notification.imageUrl,
        actionUrl: row.notification.actionUrl,
        type: row.notification.type,
        data: row.notification.data,
        isRead: row.isRead,
        readAt: row.readAt,
        createdAt: row.notification.createdAt,
      })),
      meta: { ...buildPaginationMeta(total, input), unreadCount },
    };
  }

  /** Số thông báo chưa đọc — cho cái chuông. Đi thẳng vào index `[userId, isRead]`. */
  async unreadCount(userId: string): Promise<number> {
    return this.db.notificationRecipient.count({ where: { userId, isRead: false } });
  }

  /**
   * Đánh dấu đã đọc.
   *
   * `userId` nằm trong `where` chứ không phải một phép kiểm tra riêng: id đến
   * từ client, nên thiếu ràng buộc này là ai cũng đánh dấu được thông báo của
   * người khác.
   */
  async markRead(recipientId: string, userId: string): Promise<boolean> {
    const result = await this.db.notificationRecipient.updateMany({
      where: { id: recipientId, userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return result.count > 0;
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.db.notificationRecipient.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
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
export const notificationService = new NotificationService();
