import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RegisterDeviceInput } from "@/schemas/notification.schema";

/**
 * Thiết bị nhận push của người dùng.
 *
 * ---
 * VÌ SAO `upsert` THEO `fcmToken` — KHÔNG PHẢI `(userId, fcmToken)`
 *
 * Một FCM token định danh MỘT LẦN CÀI APP TRÊN MỘT MÁY, không phải một cặp
 * (người, máy). Ràng buộc theo `(userId, fcmToken)` nhìn có vẻ chặt hơn nhưng
 * thực ra lỏng hơn, và nó đẻ ra một lỗi rất khó thấy:
 *
 *   1. Người A đăng nhập trên điện thoại P  → dòng (A, T)
 *   2. A đăng xuất, người B đăng nhập trên P → dòng (B, T)
 *   3. Cả hai dòng cùng tồn tại, cùng `isActive`
 *   4. Thông báo riêng tư gửi cho A → đẩy tới token T → hiện trên màn hình B
 *
 * Unique toàn cục thì bước 2 CHUYỂN CHỦ dòng đó, và chỉ còn đúng một chủ sở
 * hữu tại mỗi thời điểm — đúng với thực tế vật lý.
 *
 * Token cũng đổi khi người dùng cài lại app hoặc xoá dữ liệu; `upsert` giữ cho
 * một người dùng lâu năm không tích hàng trăm dòng token chết — Firebase coi
 * việc gửi tới token chết là tín hiệu xấu và hạ uy tín gửi của bạn.
 */
export class DeviceService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async register(userId: string, input: RegisterDeviceInput) {
    return this.db.userDevice.upsert({
      where: { fcmToken: input.fcmToken },
      create: {
        userId,
        platform: input.platform,
        fcmToken: input.fcmToken,
        deviceId: input.deviceId ?? null,
        deviceName: input.deviceName ?? null,
      },
      update: {
        // `userId` NẰM TRONG phần update: đây chính là bước chuyển chủ khi một
        // tài khoản khác đăng nhập trên cùng chiếc máy.
        userId,
        platform: input.platform,
        deviceId: input.deviceId ?? null,
        deviceName: input.deviceName ?? null,
        isActive: true,
        lastSeenAt: new Date(),
      },
      select: { id: true, platform: true, deviceName: true, lastSeenAt: true },
    });
  }

  async listActive(userId: string) {
    return this.db.userDevice.findMany({
      where: { userId, isActive: true },
      select: { id: true, platform: true, deviceName: true, lastSeenAt: true, createdAt: true },
      orderBy: { lastSeenAt: "desc" },
    });
  }

  /**
   * Gọi khi đăng xuất: token còn đó nhưng không nên nhận push nữa.
   *
   * `userId` vẫn nằm trong `where` dù `fcmToken` đã unique toàn cục — không có
   * nó thì biết token của người khác là tắt được push của họ.
   */
  async deactivate(userId: string, fcmToken: string): Promise<void> {
    await this.db.userDevice.updateMany({
      where: { userId, fcmToken },
      data: { isActive: false },
    });
  }

  /**
   * Token FCM của một danh sách người dùng — dùng khi gửi push.
   *
   * Chỉ lấy thiết bị đang hoạt động: gửi tới token đã tắt là tiêu băng thông
   * cho một thứ chắc chắn thất bại.
   */
  async tokensFor(userIds: string[]): Promise<string[]> {
    const rows = await this.db.userDevice.findMany({
      where: { userId: { in: userIds }, isActive: true },
      select: { fcmToken: true },
    });
    return rows.map((row) => row.fcmToken);
  }

  /**
   * Gỡ thiết bị không hoạt động quá lâu.
   *
   * FCM từ chối token quá cũ, và giữ chúng lại chỉ làm chậm mọi lần gửi.
   */
  async purgeStale(days = 180): Promise<number> {
    const result = await this.db.userDevice.deleteMany({
      where: { lastSeenAt: { lt: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } },
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
export const deviceService = new DeviceService();
