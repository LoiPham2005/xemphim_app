import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { DeviceService } from "./device.service";
import type { RegisterDeviceInput } from "@/schemas/notification.schema";

const DEVICE_ROW = {
  id: "d1",
  platform: "ANDROID",
  deviceName: "Pixel 8",
  lastSeenAt: new Date("2026-10-09T00:00:00Z"),
};

type DeviceMock = Record<
  "upsert" | "findMany" | "updateMany" | "deleteMany",
  ReturnType<typeof vi.fn>
>;

function createDb() {
  const db = {
    userDevice: {
      upsert: vi.fn().mockResolvedValue(DEVICE_ROW),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    } satisfies DeviceMock,
  };
  return db as unknown as PrismaClient & { userDevice: DeviceMock };
}

const INPUT: RegisterDeviceInput = {
  platform: "ANDROID",
  fcmToken: "tok-T",
  deviceId: "dev-1",
  deviceName: "Pixel 8",
};

type UpsertArgs = {
  where: Record<string, unknown>;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
  select: Record<string, unknown>;
};

afterEach(() => {
  vi.useRealTimers();
});

describe("DeviceService.register", () => {
  it("upsert theo fcmToken toàn cục — không theo cặp (userId, fcmToken)", async () => {
    const db = createDb();
    const result = await new DeviceService(db).register("u1", INPUT);

    // Một token là một lần cài app trên một máy. Khoá theo (userId, token) thì
    // hai người đăng nhập lần lượt trên cùng máy sẽ có hai dòng cùng sống, và
    // tin riêng của người trước hiện trên màn hình người sau.
    const args = db.userDevice.upsert.mock.calls[0]![0] as UpsertArgs;
    expect(args.where).toEqual({ fcmToken: "tok-T" });
    expect(result).toEqual(DEVICE_ROW);
  });

  it("token mới thì tạo dòng gắn với người đang đăng nhập", async () => {
    const db = createDb();
    await new DeviceService(db).register("u1", INPUT);

    const args = db.userDevice.upsert.mock.calls[0]![0] as UpsertArgs;
    expect(args.create).toEqual({
      userId: "u1",
      platform: "ANDROID",
      fcmToken: "tok-T",
      deviceId: "dev-1",
      deviceName: "Pixel 8",
    });
  });

  it("token đã có của người khác thì CHUYỂN CHỦ sang người vừa đăng nhập và bật lại", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T08:00:00Z"));
    const db = createDb();

    await new DeviceService(db).register("u2", INPUT);

    // `userId` nằm trong phần update chính là bước chuyển chủ: thiếu nó thì
    // máy đổi người dùng nhưng push vẫn bay về tài khoản cũ.
    const args = db.userDevice.upsert.mock.calls[0]![0] as UpsertArgs;
    expect(args.update).toEqual({
      userId: "u2",
      platform: "ANDROID",
      deviceId: "dev-1",
      deviceName: "Pixel 8",
      // Token từng bị tắt khi đăng xuất phải được bật lại khi đăng nhập lại,
      // nếu không người dùng sẽ không bao giờ nhận push nữa.
      isActive: true,
      lastSeenAt: new Date("2026-10-10T08:00:00Z"),
    });
  });

  it("deviceId/deviceName bỏ trống được ghi thành null ở cả hai nhánh", async () => {
    const db = createDb();
    await new DeviceService(db).register("u1", { platform: "IOS", fcmToken: "tok-I" });

    // `undefined` với Prisma là "không đụng tới cột"; ghi rõ null để dữ liệu
    // của lần đăng ký này không lẫn với thông tin máy của chủ cũ.
    const args = db.userDevice.upsert.mock.calls[0]![0] as UpsertArgs;
    expect(args.create).toMatchObject({ deviceId: null, deviceName: null });
    expect(args.update).toMatchObject({ deviceId: null, deviceName: null });
  });

  it("không trả fcmToken về cho client", async () => {
    const db = createDb();
    await new DeviceService(db).register("u1", INPUT);

    // Token là thứ đủ để gửi push tới máy đó — không có lý do gì để nó đi
    // ngược ra ngoài qua API.
    const args = db.userDevice.upsert.mock.calls[0]![0] as UpsertArgs;
    expect(args.select).not.toHaveProperty("fcmToken");
  });
});

describe("DeviceService.listActive", () => {
  it("chỉ liệt kê thiết bị đang hoạt động của chính người dùng, mới nhất trước", async () => {
    const db = createDb();
    db.userDevice.findMany.mockResolvedValue([DEVICE_ROW]);

    const result = await new DeviceService(db).listActive("u1");

    expect(result).toEqual([DEVICE_ROW]);
    const args = db.userDevice.findMany.mock.calls[0]![0] as {
      where: object;
      select: object;
      orderBy: object;
    };
    expect(args.where).toEqual({ userId: "u1", isActive: true });
    expect(args.orderBy).toEqual({ lastSeenAt: "desc" });
    expect(args.select).not.toHaveProperty("fcmToken");
  });
});

describe("DeviceService.deactivate", () => {
  it("ràng buộc chủ sở hữu nằm trong where dù fcmToken đã unique", async () => {
    const db = createDb();
    await new DeviceService(db).deactivate("u1", "tok-T");

    // Không có `userId` thì chỉ cần biết token của người khác là tắt được
    // push của họ.
    expect(db.userDevice.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", fcmToken: "tok-T" },
      data: { isActive: false },
    });
  });

  it("chỉ tắt, không xoá dòng — đăng nhập lại trên cùng máy sẽ bật lại qua register", async () => {
    const db = createDb();
    db.userDevice.updateMany.mockResolvedValue({ count: 0 });

    // Token của người khác hoặc không tồn tại: lặng lẽ không làm gì, không
    // ném lỗi để lộ token nào có thật.
    await expect(new DeviceService(db).deactivate("u2", "tok-T")).resolves.toBeUndefined();
    expect(db.userDevice.deleteMany).not.toHaveBeenCalled();
  });
});

describe("DeviceService.tokensFor", () => {
  it("chỉ lấy token của thiết bị đang hoạt động thuộc danh sách người nhận", async () => {
    const db = createDb();
    db.userDevice.findMany.mockResolvedValue([{ fcmToken: "t1" }, { fcmToken: "t2" }]);

    const tokens = await new DeviceService(db).tokensFor(["u1", "u2"]);

    // Gửi tới token đã tắt là tốn băng thông cho một thứ chắc chắn thất bại,
    // và FCM hạ uy tín bên gửi khi thấy nhiều token chết.
    expect(tokens).toEqual(["t1", "t2"]);
    expect(db.userDevice.findMany).toHaveBeenCalledWith({
      where: { userId: { in: ["u1", "u2"] }, isActive: true },
      select: { fcmToken: true },
    });
  });
});

describe("DeviceService.purgeStale", () => {
  it("mặc định xoá thiết bị không thấy mặt quá 180 ngày", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T00:00:00Z"));
    const db = createDb();
    db.userDevice.deleteMany.mockResolvedValue({ count: 3 });

    await expect(new DeviceService(db).purgeStale()).resolves.toBe(3);
    // 10/10/2026 lùi 180 ngày = 13/04/2026.
    expect(db.userDevice.deleteMany).toHaveBeenCalledWith({
      where: { lastSeenAt: { lt: new Date("2026-04-13T00:00:00Z") } },
    });
  });

  it("nhận số ngày tuỳ chỉnh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T00:00:00Z"));
    const db = createDb();

    await new DeviceService(db).purgeStale(30);
    expect(db.userDevice.deleteMany).toHaveBeenCalledWith({
      where: { lastSeenAt: { lt: new Date("2026-09-10T00:00:00Z") } },
    });
  });
});
