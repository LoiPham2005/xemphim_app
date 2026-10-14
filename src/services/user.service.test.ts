import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { UserService } from "./user.service";
import type { PermissionService } from "./permission.service";
import {
  AccountBannedError,
  AccountInactiveError,
  assertLoginAllowed,
  DuplicateFieldError,
  InsufficientRoleLevelError,
  SelfActionForbiddenError,
  UnknownRoleKeyError,
} from "@/lib/errors";

const USER_ROW = {
  id: "u1",
  email: "a@b.com",
  phone: null,
  username: null,
  status: "ACTIVE",
  emailVerifiedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  profile: { fullName: "Nguyễn A", avatarUrl: null },
  userRoles: [{ role: { key: "USER" } }],
};

/**
 * @param levels Bậc vai trò theo từng userId, cho các test leo thang đặc quyền.
 * `userRole.findMany` trả về đúng bộ vai trò của người được hỏi.
 */
function createDb(
  overrides: { user?: Record<string, unknown>; role?: Record<string, unknown> } = {},
  levels: Record<string, number> = {},
) {
  return {
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn().mockResolvedValue(USER_ROW),
      findMany: vi.fn().mockResolvedValue([USER_ROW]),
      count: vi.fn().mockResolvedValue(1),
      create: vi.fn().mockResolvedValue(USER_ROW),
      update: vi.fn().mockResolvedValue(USER_ROW),
      ...overrides.user,
    },
    role: {
      findMany: vi.fn().mockResolvedValue([{ id: "r-user", key: "USER", level: 0 }]),
      ...overrides.role,
    },
    userRole: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(({ where }: { where: { userId: string } }) => {
        const level = levels[where.userId];
        return Promise.resolve(level === undefined ? [] : [{ role: { level } }]);
      }),
    },
    userProfile: { upsert: vi.fn() },
    userPermission: { upsert: vi.fn(), deleteMany: vi.fn() },
    permission: { findUnique: vi.fn().mockResolvedValue({ id: "p1" }) },
    // `softDelete` gọi `$transaction([...])` với một MẢNG, nên các lệnh trong
    // đó chạy trên client gốc chứ không trên `tx`.
    refreshToken: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    // Chạy callback ngay tại chỗ thay vì mở transaction thật: test này kiểm
    // logic nghiệp vụ, không kiểm Postgres.
    $transaction: vi.fn((arg: unknown) =>
      Promise.resolve(
        typeof arg === "function" ? (arg as (tx: unknown) => unknown)(createTx()) : [],
      ),
    ),
  } as unknown as PrismaClient;
}

function createTx() {
  return {
    user: { update: vi.fn().mockResolvedValue(USER_ROW) },
    userRole: { deleteMany: vi.fn(), createMany: vi.fn() },
    // `setStatus` thu hồi phiên ngay trong cùng transaction khi khoá tài khoản
    // — khoá mà để phiên cũ sống tiếp thì việc khoá gần như vô nghĩa.
    refreshToken: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
}

/** `PermissionService` giả — chỉ cần đếm xem cache có bị xoá hay không. */
function createPermissions() {
  return {
    invalidateUser: vi.fn().mockResolvedValue(undefined),
    invalidateAll: vi.fn().mockResolvedValue(undefined),
  } as unknown as PermissionService & {
    invalidateUser: ReturnType<typeof vi.fn>;
  };
}

const baseInput = { email: "a@b.com", status: "ACTIVE" as const };

describe("UserService", () => {
  describe("create", () => {
    it("băm mật khẩu, KHÔNG bao giờ lưu chuỗi gốc", async () => {
      const db = createDb();

      await new UserService(db).create({ ...baseInput, password: "matkhau123" });

      const data = vi.mocked(db.user.create).mock.calls[0]![0].data as { password: string };
      expect(data.password).not.toBe("matkhau123");
      expect(data.password).toMatch(/^\$argon2id\$/);
    });

    it("lưu password NULL — không phải chuỗi rỗng — khi không truyền mật khẩu", async () => {
      // Chuỗi rỗng là một mật khẩu "hợp lệ" nhìn từ tầng dữ liệu; null mới nói
      // đúng rằng tài khoản này chưa đặt mật khẩu.
      const db = createDb();

      await new UserService(db).create(baseInput);

      const data = vi.mocked(db.user.create).mock.calls[0]![0].data as { password: null };
      expect(data.password).toBeNull();
    });

    it("mặc định gán vai trò USER khi không chỉ định", async () => {
      const db = createDb();

      await new UserService(db).create(baseInput);

      expect(db.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: { in: ["USER"] } } }),
      );
    });

    it("từ chối vai trò không tồn tại thay vì lặng lẽ bỏ qua", async () => {
      // Bỏ qua nghĩa là admin bấm "gán vai trò KE_TOAN", hệ thống báo thành
      // công, mà người dùng không nhận được vai trò nào.
      const db = createDb({ role: { findMany: vi.fn().mockResolvedValue([]) } });

      await expect(
        new UserService(db).create({ ...baseInput, roleKeys: ["KE_TOAN"] }),
      ).rejects.toBeInstanceOf(UnknownRoleKeyError);
    });

    it("báo đúng TRƯỜNG bị trùng, không phải lỗi chung chung", async () => {
      const db = createDb({
        user: {
          findFirst: vi.fn().mockResolvedValue({ email: "a@b.com", username: null, phone: null }),
        },
      });

      await expect(new UserService(db).create(baseInput)).rejects.toBeInstanceOf(
        DuplicateFieldError,
      );
    });

    it("không select cột password, nên nó không thể rò ra khỏi service", async () => {
      const db = createDb();

      const user = await new UserService(db).create(baseInput);

      const select = vi.mocked(db.user.create).mock.calls[0]![0].select as Record<string, unknown>;
      expect(select.password).toBeUndefined();
      expect(user).not.toHaveProperty("password");
    });

    it("không nuốt lỗi lạ của database", async () => {
      const db = createDb({
        user: { create: vi.fn().mockRejectedValue(new Error("connection lost")) },
      });

      await expect(new UserService(db).create(baseInput)).rejects.toThrow("connection lost");
    });
  });

  describe("list", () => {
    it("bỏ qua tài khoản đã xoá mềm theo mặc định", async () => {
      const db = createDb();

      await new UserService(db).list({ page: 1, limit: 20, includeDeleted: false });

      const args = vi.mocked(db.user.findMany).mock.calls[0]![0]!;
      expect(args.where).toMatchObject({ deletedAt: null });
      expect(args.take).toBe(20);
      expect(args.skip).toBe(0);
    });

    it("trả metadata phân trang khớp với tổng số bản ghi", async () => {
      const db = createDb({ user: { count: vi.fn().mockResolvedValue(45) } });

      const page = await new UserService(db).list({ page: 2, limit: 20, includeDeleted: false });

      expect(page.meta).toMatchObject({
        page: 2,
        limit: 20,
        total: 45,
        totalPages: 3,
        hasNext: true,
      });
    });
  });

  describe("chốt chặn leo thang đặc quyền", () => {
    it("ADMIN không tạo được tài khoản SUPER_ADMIN", async () => {
      /*
       * Đây là đường leo thang rõ nhất, và chốt "không tự đổi vai trò của
       * chính mình" KHÔNG cứu được: kẻ tấn công tạo một tài khoản KHÁC mang
       * vai trò tối cao rồi đăng nhập vào đó.
       */
      const db = createDb(
        {
          role: {
            findMany: vi.fn().mockResolvedValue([{ id: "r-sa", key: "SUPER_ADMIN", level: 100 }]),
          },
        },
        { admin: 50 },
      );

      await expect(
        new UserService(db).create({ ...baseInput, roleKeys: ["SUPER_ADMIN"], actorId: "admin" }),
      ).rejects.toBeInstanceOf(InsufficientRoleLevelError);
    });

    it("ADMIN không gán được vai trò NGANG bậc mình", async () => {
      // "Bằng" cũng bị chặn: cho phép ADMIN nhân bản ADMIN nghĩa là bậc đó
      // tăng vô hạn và không ai gỡ được — vì ADMIN cũng không đụng được vào
      // ADMIN khác.
      const db = createDb(
        {
          role: { findMany: vi.fn().mockResolvedValue([{ id: "r-ad", key: "ADMIN", level: 50 }]) },
        },
        { admin: 50 },
      );

      await expect(
        new UserService(db).create({ ...baseInput, roleKeys: ["ADMIN"], actorId: "admin" }),
      ).rejects.toBeInstanceOf(InsufficientRoleLevelError);
    });

    it("ADMIN không sửa/khoá/xoá được tài khoản SUPER_ADMIN", async () => {
      const db = createDb(
        { user: { findFirst: vi.fn().mockResolvedValue({ id: "sa" }) } },
        { admin: 50, sa: 100 },
      );
      const service = new UserService(db);

      await expect(
        service.update("sa", { status: "BANNED" }, { actorId: "admin" }),
      ).rejects.toBeInstanceOf(InsufficientRoleLevelError);

      await expect(service.setStatus("sa", "BANNED", { actorId: "admin" })).rejects.toBeInstanceOf(
        InsufficientRoleLevelError,
      );

      await expect(service.softDelete("sa", { actorId: "admin" })).rejects.toBeInstanceOf(
        InsufficientRoleLevelError,
      );
    });

    it("ADMIN không cấp/tước được quyền lẻ cho SUPER_ADMIN", async () => {
      // Cấp quyền lẻ là một dạng đổi thẩm quyền — nếu không chịu cùng chốt
      // chặn thì nó trở thành đường vòng quanh luật vai trò.
      const db = createDb({}, { admin: 50, sa: 100 });

      await expect(
        new UserService(db).setUserPermission("sa", "user:delete", false, { actorId: "admin" }),
      ).rejects.toBeInstanceOf(InsufficientRoleLevelError);
    });

    it("SUPER_ADMIN thao tác được lên ADMIN", async () => {
      const db = createDb(
        { user: { findFirst: vi.fn().mockResolvedValue({ id: "admin" }) } },
        { sa: 100, admin: 50 },
      );

      await expect(
        new UserService(db).setStatus("admin", "BANNED", { actorId: "sa" }),
      ).resolves.toBeDefined();
    });

    it("thao tác của HỆ THỐNG (không có actor) không bị chặn", async () => {
      // Seed, script, job nền — không có ai để so bậc, và bỏ qua là đúng.
      const db = createDb({}, {});

      await expect(
        new UserService(db).create({ ...baseInput, roleKeys: ["USER"] }),
      ).resolves.toBeDefined();
    });
  });

  describe("chốt chặn tự bắn vào chân mình", () => {
    it("không cho tự đổi vai trò của chính mình", async () => {
      // Không có chốt này thì quản trị viên cuối cùng tự khoá mình ra ngoài chỉ
      // bằng một cú bấm nhầm, và không còn ai vào sửa được.
      const db = createDb({ user: { findFirst: vi.fn().mockResolvedValue({ id: "u1" }) } });

      await expect(
        new UserService(db).update("u1", { roleKeys: ["USER"] }, { actorId: "u1" }),
      ).rejects.toBeInstanceOf(SelfActionForbiddenError);
    });

    it("không cho tự khoá và tự xoá chính mình", async () => {
      const db = createDb();
      const service = new UserService(db);

      await expect(service.setStatus("u1", "BANNED", { actorId: "u1" })).rejects.toBeInstanceOf(
        SelfActionForbiddenError,
      );
      await expect(service.softDelete("u1", { actorId: "u1" })).rejects.toBeInstanceOf(
        SelfActionForbiddenError,
      );
    });
  });
});

describe("assertLoginAllowed", () => {
  it("chặn cả BANNED lẫn INACTIVE, cho ACTIVE đi qua", () => {
    // Gom vào một hàm dùng chung cho cả ba đường đăng nhập (mật khẩu, OAuth,
    // passkey). Bốn chỗ kiểm tra riêng lẻ là bốn cơ hội để một đường mới quên
    // mất luật.
    expect(() => assertLoginAllowed("ACTIVE")).not.toThrow();
    expect(() => assertLoginAllowed("BANNED")).toThrow(AccountBannedError);
    expect(() => assertLoginAllowed("INACTIVE")).toThrow(AccountInactiveError);
  });
});

/**
 * Quyền được cache 60 giây, nên MỌI đường ghi đụng tới thẩm quyền phải xoá
 * cache của người bị ảnh hưởng.
 *
 * Chiều "cấp thêm" mà quên chỉ gây khó hiểu: admin tick một quyền, thử ngay,
 * thấy vẫn 403. Chiều "tước bỏ" thì là lỗ hổng thật — người vừa bị gỡ vai trò
 * vẫn thao tác được như cũ thêm một phút nữa.
 *
 * Đây là lỗi ĐÃ XẢY RA: `setUserPermission` ghi đúng vào database nhưng không
 * xoá cache, nên cấp quyền xong gọi lại API vẫn nhận 403.
 */
describe("xoá cache quyền sau mỗi lần ghi thẩm quyền", () => {
  it("create: người mới có vai trò ngay từ request đầu tiên", async () => {
    const permissions = createPermissions();

    await new UserService(createDb(), permissions).create(baseInput);

    expect(permissions.invalidateUser).toHaveBeenCalledWith("u1");
  });

  it("update: đổi vai trò có hiệu lực NGAY, không đợi cache hết hạn", async () => {
    const permissions = createPermissions();
    const db = createDb({
      user: { findFirst: vi.fn().mockResolvedValue(USER_ROW) },
      role: { findMany: vi.fn().mockResolvedValue([{ id: "r-admin", key: "ADMIN", level: 50 }]) },
    });

    await new UserService(db, permissions).update("u1", { roleKeys: ["ADMIN"] });

    expect(permissions.invalidateUser).toHaveBeenCalledWith("u1");
  });

  it("setUserPermission: cấp quyền lẻ có hiệu lực ngay", async () => {
    const permissions = createPermissions();

    await new UserService(createDb(), permissions).setUserPermission("u1", "user:read", true);

    expect(permissions.invalidateUser).toHaveBeenCalledWith("u1");
  });

  it("clearUserPermission: gỡ ngoại lệ có hiệu lực ngay", async () => {
    const permissions = createPermissions();

    await new UserService(createDb(), permissions).clearUserPermission("u1", "user:read");

    expect(permissions.invalidateUser).toHaveBeenCalledWith("u1");
  });

  it("softDelete: tài khoản đã xoá không còn quyền nào trong cache", async () => {
    const permissions = createPermissions();
    const db = createDb({
      user: { findFirst: vi.fn().mockResolvedValue({ id: "u1", email: "a@b.com" }) },
    });

    await new UserService(db, permissions).softDelete("u1");

    expect(permissions.invalidateUser).toHaveBeenCalledWith("u1");
  });
});

describe("ảnh đại diện (avatarFileId)", () => {
  /** tx có đủ `userProfile` + `file` — `update()` gắn/gỡ tệp TRONG transaction. */
  function setup(opts: { currentAvatar?: string | null; file?: Record<string, unknown> | null }) {
    const tx = {
      ...createTx(),
      userProfile: {
        findUnique: vi.fn().mockResolvedValue({ avatarFileId: opts.currentAvatar ?? null }),
        upsert: vi.fn(),
      },
      file: {
        findUnique: vi.fn().mockResolvedValue(
          opts.file === undefined
            ? {
                id: "new",
                uploadedById: "u1",
                attachedAt: null,
                mimeType: "image/png",
                status: "READY",
              }
            : opts.file,
        ),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const db = createDb(
      { user: { findFirst: vi.fn().mockResolvedValue(USER_ROW) } },
      { admin: 50, u1: 0 },
    );
    Object.assign(db, {
      $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    });
    return { tx, service: new UserService(db, createPermissions()) };
  }

  it("đổi ảnh: gắn tệp mới, GỠ tệp cũ (thành mồ côi để dọn), trỏ hồ sơ sang tệp mới", async () => {
    const { tx, service } = setup({ currentAvatar: "old" });

    await service.update("u1", { avatarFileId: "new" }, { actorId: "u1" });

    expect(tx.file.updateMany).toHaveBeenCalledWith({
      where: { id: "new", attachedAt: null },
      data: { attachedAt: expect.any(Date) },
    });
    expect(tx.file.updateMany).toHaveBeenCalledWith({
      where: { id: "old" },
      data: { attachedAt: null },
    });
    expect(tx.userProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { avatarFileId: "new" } }),
    );
  });

  it("admin đổi ảnh hộ được bằng tệp CHÍNH admin tải lên", async () => {
    const { tx, service } = setup({
      file: {
        id: "new",
        uploadedById: "admin",
        attachedAt: null,
        mimeType: "image/png",
        status: "READY",
      },
    });

    await service.update("u1", { avatarFileId: "new" }, { actorId: "admin" });

    expect(tx.userProfile.upsert).toHaveBeenCalled();
  });

  it("không dùng được tệp của NGƯỜI KHÁC làm avatar — báo 422 vào đúng trường", async () => {
    const { tx, service } = setup({
      file: {
        id: "new",
        uploadedById: "u2",
        attachedAt: null,
        mimeType: "image/png",
        status: "READY",
      },
    });

    await expect(
      service.update("u1", { avatarFileId: "new" }, { actorId: "u1" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: { avatarFileId: expect.any(Array) },
    });
    expect(tx.userProfile.upsert).not.toHaveBeenCalled();
  });

  it("tự sửa CHÍNH MÌNH được (trước đây bị chặn vì so bậc vai trò với chính mình)", async () => {
    const { service } = setup({});
    await expect(
      service.update("u1", { fullName: "Tên mới" }, { actorId: "u1" }),
    ).resolves.toBeDefined();
  });

  it("tự sửa chính mình KHÔNG được đổi email/SĐT/username/trạng thái — có luồng xác minh riêng", async () => {
    const { service } = setup({});
    await expect(
      service.update("u1", { email: "moi@b.com" }, { actorId: "u1" }),
    ).rejects.toBeInstanceOf(SelfActionForbiddenError);
    await expect(
      service.update("u1", { status: "INACTIVE" }, { actorId: "u1" }),
    ).rejects.toBeInstanceOf(SelfActionForbiddenError);
  });

  it("`null` = gỡ ảnh: tệp cũ thành mồ côi, không gắn gì mới", async () => {
    const { tx, service } = setup({ currentAvatar: "old" });

    await service.update("u1", { avatarFileId: null }, { actorId: "u1" });

    expect(tx.file.findUnique).not.toHaveBeenCalled();
    expect(tx.file.updateMany).toHaveBeenCalledWith({
      where: { id: "old" },
      data: { attachedAt: null },
    });
    expect(tx.userProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { avatarFileId: null } }),
    );
  });
});
