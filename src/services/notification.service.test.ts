import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type * as QueueModule from "@/lib/queue";
import type { ListNotificationsInput, SendNotificationInput } from "@/schemas/notification.schema";

// Thay hàng đợi bằng hàm giả: test này kiểm luật nghiệp vụ của service, không
// cần Redis. Giữ nguyên các export khác để không làm vỡ chỗ nào import chung.
const queue = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("@/lib/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof QueueModule>()),
  enqueue: queue.enqueue,
}));

const { NotificationService } = await import("./notification.service");

const CREATED_AT = new Date("2026-10-09T00:00:00Z");

const RECIPIENT_ROW = {
  id: "rcp-1",
  isRead: false,
  readAt: null,
  createdAt: new Date("2026-10-09T01:00:00Z"),
  notification: {
    id: "n1",
    title: "Đơn hàng đã giao",
    body: "Đơn #123 đã tới nơi",
    imageUrl: null,
    actionUrl: "/orders/123",
    type: "DIRECT" as const,
    data: { orderId: "123" },
    createdAt: CREATED_AT,
  },
};

type Mocks = {
  user: { findMany: ReturnType<typeof vi.fn> };
  notification: { create: ReturnType<typeof vi.fn> };
  notificationRecipient: Record<"count" | "findMany" | "updateMany", ReturnType<typeof vi.fn>>;
};

function createDb() {
  const db = {
    user: {
      findMany: vi.fn().mockResolvedValue([{ id: "u1" }, { id: "u2" }, { id: "u3" }]),
    },
    notification: {
      create: vi.fn().mockResolvedValue({ id: "n1", createdAt: CREATED_AT }),
    },
    notificationRecipient: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([RECIPIENT_ROW]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  } satisfies Mocks;
  return db as unknown as PrismaClient & Mocks;
}

function sendInput(overrides: Partial<SendNotificationInput> = {}): SendNotificationInput {
  return {
    title: "Xin chào",
    body: "Nội dung thông báo",
    type: "DIRECT",
    userIds: ["u1", "u2"],
    ...overrides,
  };
}

const LIST_INPUT: ListNotificationsInput = { page: 2, limit: 10, unreadOnly: false };

beforeEach(() => {
  queue.enqueue.mockReset();
});

describe("NotificationService.send", () => {
  it("DIRECT gửi đúng danh sách người nhận được chỉ định, không đụng tới bảng user", async () => {
    const db = createDb();
    const result = await new NotificationService(db).send(sendInput());

    // Gửi DIRECT mà lại đi quét bảng user là vừa tốn vừa nguy hiểm: một lỗi
    // nhánh nhỏ là biến tin riêng thành tin gửi cả hệ thống.
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "n1", recipientCount: 2, createdAt: CREATED_AT });
  });

  it("nội dung lưu một bản, người nhận tạo hàng loạt và bỏ qua trùng lặp", async () => {
    const db = createDb();
    await new NotificationService(db).send(sendInput({ userIds: ["u1", "u1", "u2"] }));

    const { data } = db.notification.create.mock.calls[0]![0] as {
      data: { recipients: { createMany: { data: unknown[]; skipDuplicates: boolean } } };
    };
    // Bên gọi lỡ đưa trùng một người không phải lý do để cả lần gửi thất bại.
    expect(data.recipients.createMany.skipDuplicates).toBe(true);
    expect(data.recipients.createMany.data).toEqual([
      { userId: "u1" },
      { userId: "u1" },
      { userId: "u2" },
    ]);
  });

  it("trường tuỳ chọn bỏ trống được ghi thành null, có người gửi thì lưu người gửi", async () => {
    const db = createDb();
    await new NotificationService(db).send(
      sendInput({ imageUrl: "https://cdn.test/a.png", actionUrl: "/x", data: { k: 1 } }),
      "admin-1",
    );
    await new NotificationService(db).send(sendInput());

    const first = (db.notification.create.mock.calls[0]![0] as { data: Record<string, unknown> })
      .data;
    const second = (db.notification.create.mock.calls[1]![0] as { data: Record<string, unknown> })
      .data;
    expect(first).toMatchObject({
      imageUrl: "https://cdn.test/a.png",
      actionUrl: "/x",
      data: { k: 1 },
      senderId: "admin-1",
    });
    // `undefined` khác `null` với Prisma: undefined là "không đụng tới cột",
    // null mới là "giá trị rỗng". Ghi rõ null để bản ghi không phụ thuộc mặc
    // định của schema.
    expect(second).toMatchObject({ imageUrl: null, actionUrl: null, senderId: null });
  });

  it("BROADCAST chỉ lấy người dùng đang hoạt động và chưa bị xoá", async () => {
    const db = createDb();
    const result = await new NotificationService(db).send(
      sendInput({ type: "BROADCAST", userIds: ["bị-bỏ-qua"] }),
    );

    // Gửi cho tài khoản đã khoá hay đã xoá mềm là rò thông tin tới người
    // không còn quyền nhận.
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "ACTIVE", deletedAt: null } }),
    );
    expect(result.recipientCount).toBe(3);
    expect(queue.enqueue).toHaveBeenCalledWith("push:send", {
      notificationId: "n1",
      userIds: ["u1", "u2", "u3"],
    });
  });

  it("push đi qua hàng đợi kèm id thông báo và danh sách người nhận", async () => {
    const db = createDb();
    await new NotificationService(db).send(sendInput());

    // Gửi FCM có thể mất hàng chục giây; người bấm "Gửi" không nên phải chờ.
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledWith("push:send", {
      notificationId: "n1",
      userIds: ["u1", "u2"],
    });
  });

  it("không có người nhận nào thì không xếp job push rỗng", async () => {
    const db = createDb();
    db.user.findMany.mockResolvedValue([]);

    const broadcast = await new NotificationService(db).send(sendInput({ type: "BROADCAST" }));
    const topic = await new NotificationService(db).send(
      sendInput({ type: "TOPIC", userIds: undefined }),
    );

    // Job rỗng vẫn chiếm một lượt worker và một dòng log — vô ích.
    expect(broadcast.recipientCount).toBe(0);
    expect(topic.recipientCount).toBe(0);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});

describe("NotificationService.listForUser", () => {
  it("chỉ đọc thông báo của chính người dùng, phân trang và sắp mới nhất trước", async () => {
    const db = createDb();
    await new NotificationService(db).listForUser("u1", LIST_INPUT);

    // `userId` phải nằm trong `where` của MỌI câu truy vấn — thiếu một chỗ là
    // hộp thư hoặc con số đếm lẫn dữ liệu của người khác.
    expect(db.notificationRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1" },
        orderBy: { createdAt: "desc" },
        skip: 10,
        take: 10,
      }),
    );
    expect(db.notificationRecipient.count).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(db.notificationRecipient.count).toHaveBeenCalledWith({
      where: { userId: "u1", isRead: false },
    });
  });

  it("lọc chưa đọc áp vào cả danh sách lẫn tổng số trang", async () => {
    const db = createDb();
    await new NotificationService(db).listForUser("u1", { ...LIST_INPUT, unreadOnly: true });

    // Lọc danh sách mà tổng vẫn đếm cả thông báo đã đọc thì client sẽ phân
    // trang sai — trang cuối trống trơn.
    const where = { userId: "u1", isRead: false };
    expect(db.notificationRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where }),
    );
    expect(db.notificationRecipient.count).toHaveBeenNthCalledWith(1, { where });
  });

  it("làm phẳng dòng người nhận + nội dung; recipientId là id để gọi markRead", async () => {
    const db = createDb();
    db.notificationRecipient.count
      .mockResolvedValueOnce(25) // tổng
      .mockResolvedValueOnce(4); // chưa đọc

    const { items, meta } = await new NotificationService(db).listForUser("u1", LIST_INPUT);

    // Nhầm `id` nội dung với `recipientId` thì client gọi markRead với id
    // dùng chung — không bao giờ khớp dòng nào của người dùng.
    expect(items).toEqual([
      {
        recipientId: "rcp-1",
        id: "n1",
        title: "Đơn hàng đã giao",
        body: "Đơn #123 đã tới nơi",
        imageUrl: null,
        actionUrl: "/orders/123",
        type: "DIRECT",
        data: { orderId: "123" },
        isRead: false,
        readAt: null,
        createdAt: CREATED_AT,
      },
    ]);
    expect(meta).toEqual({
      page: 2,
      limit: 10,
      total: 25,
      totalPages: 3,
      hasNext: true,
      unreadCount: 4,
    });
  });
});

describe("NotificationService.unreadCount", () => {
  it("đếm đúng thông báo chưa đọc của chính người dùng", async () => {
    const db = createDb();
    db.notificationRecipient.count.mockResolvedValue(7);

    await expect(new NotificationService(db).unreadCount("u1")).resolves.toBe(7);
    expect(db.notificationRecipient.count).toHaveBeenCalledWith({
      where: { userId: "u1", isRead: false },
    });
  });
});

describe("NotificationService.markRead", () => {
  it("ràng buộc chủ sở hữu nằm ngay trong câu cập nhật", async () => {
    const db = createDb();
    await new NotificationService(db).markRead("rcp-1", "u1");

    // Id đến từ client: không có `userId` trong `where` thì ai cũng đánh dấu
    // được thông báo của người khác. Đặt trong cùng câu lệnh (thay vì đọc rồi
    // kiểm) cũng loại bỏ khe hở giữa hai bước.
    const call = db.notificationRecipient.updateMany.mock.calls[0]![0] as {
      where: object;
      data: { isRead: boolean; readAt: Date };
    };
    expect(call.where).toEqual({ id: "rcp-1", userId: "u1", isRead: false });
    expect(call.data.isRead).toBe(true);
    expect(call.data.readAt).toBeInstanceOf(Date);
  });

  it("trả false khi không dòng nào khớp — của người khác, không tồn tại hoặc đã đọc", async () => {
    const db = createDb();
    db.notificationRecipient.updateMany.mockResolvedValue({ count: 0 });

    // Không ném lỗi phân biệt "không tồn tại" với "không phải của bạn": ném
    // khác nhau là để lộ id nào có thật.
    await expect(new NotificationService(db).markRead("rcp-x", "u2")).resolves.toBe(false);
  });

  it("trả true khi đánh dấu thành công", async () => {
    const db = createDb();
    await expect(new NotificationService(db).markRead("rcp-1", "u1")).resolves.toBe(true);
  });
});

describe("NotificationService.markAllRead", () => {
  it("chỉ đánh dấu thông báo chưa đọc của chính người dùng và trả số dòng đã đổi", async () => {
    const db = createDb();
    db.notificationRecipient.updateMany.mockResolvedValue({ count: 5 });

    await expect(new NotificationService(db).markAllRead("u1")).resolves.toBe(5);
    // Lọc `isRead: false` để không ghi đè `readAt` của thông báo đã đọc từ
    // trước — mốc thời gian đó là lịch sử thật, không nên bị làm mới.
    const call = db.notificationRecipient.updateMany.mock.calls[0]![0] as {
      where: object;
      data: { isRead: boolean; readAt: Date };
    };
    expect(call.where).toEqual({ userId: "u1", isRead: false });
    expect(call.data.isRead).toBe(true);
    expect(call.data.readAt).toBeInstanceOf(Date);
  });
});
