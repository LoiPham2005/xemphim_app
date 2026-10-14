import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { RoleService } from "./role.service";
import type { PermissionService } from "./permission.service";
import {
  InsufficientRoleLevelError,
  RoleInUseError,
  RoleKeyAlreadyExistsError,
  RoleNotFoundError,
  SystemRoleImmutableError,
  UnknownPermissionError,
} from "@/lib/errors";

/** Thao tác của HỆ THỐNG (seed, script) — bỏ qua chốt chặn theo `level`. */
const SYSTEM = { actorId: null };

const NOW = new Date("2026-01-01T00:00:00Z");

/** Một dòng `role.findMany` đúng hình dạng `select` của `list()`. */
function roleRow(key: string, level: number, permissionKeys: string[] = [], userCount = 0) {
  return {
    id: `r-${key}`,
    key,
    name: key,
    description: null,
    level,
    isSystem: false,
    createdAt: NOW,
    updatedAt: NOW,
    permissions: permissionKeys.map((permissionKey) => ({ permission: { key: permissionKey } })),
    _count: { userRoles: userCount },
  };
}

/** Bảng `permission` trong database: chỉ những khoá này đã được seed. */
const SEEDED_PERMISSIONS = [
  { id: "p-user-read", key: "user:read" },
  { id: "p-user-create", key: "user:create" },
  { id: "p-role-read", key: "role:read" },
];

/**
 * @param levels Bậc vai trò theo từng userId — để thử luật chặn leo thang.
 * `userRole.findMany` trả về đúng bộ vai trò của người được hỏi.
 */
function createDb(
  overrides: { role?: Record<string, unknown>; permission?: Record<string, unknown> } = {},
  levels: Record<string, number[]> = {},
) {
  const tx = createTx();
  const db = {
    role: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([roleRow("EDITOR", 10, ["user:read"])]),
      create: vi.fn().mockResolvedValue({ id: "r-EDITOR" }),
      delete: vi.fn().mockResolvedValue({ id: "r-EDITOR" }),
      ...overrides.role,
    },
    permission: {
      findMany: vi.fn(({ where }: { where: { key: { in: string[] } } }) =>
        Promise.resolve(SEEDED_PERMISSIONS.filter((row) => where.key.in.includes(row.key))),
      ),
      ...overrides.permission,
    },
    userRole: {
      findMany: vi.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve((levels[where.userId] ?? []).map((level) => ({ role: { level } }))),
      ),
    },
    // Chạy callback ngay tại chỗ trên một `tx` giả: test này kiểm logic nghiệp
    // vụ, không kiểm Postgres.
    $transaction: vi.fn((callback: (client: unknown) => unknown) => Promise.resolve(callback(tx))),
  };
  return { db: db as unknown as PrismaClient, raw: db, tx };
}

function createTx() {
  return {
    role: { update: vi.fn().mockResolvedValue({}) },
    rolePermission: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
}

/** `PermissionService` giả — chỉ cần biết cache quyền có bị xoá hay không. */
function createPermissions() {
  const invalidateAll = vi.fn().mockResolvedValue(undefined);
  return {
    permissions: { invalidateAll, invalidateUser: vi.fn() } as unknown as PermissionService,
    invalidateAll,
  };
}

/**
 * Đối số của lần gọi đầu tiên tới một hàm giả. Ép kiểu ở MỘT chỗ để từng test
 * đọc thẳng `data`/`orderBy` mà không rải `as` khắp nơi.
 */
function argOf(fn: unknown): { where?: unknown; data?: unknown; orderBy?: unknown } {
  return (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
    where?: unknown;
    data?: unknown;
    orderBy?: unknown;
  };
}

/**
 * Dùng như `.then(noError, caught)`: thao tác lọt qua mà không ném thì test đỏ
 * ngay, thay vì đem kết quả thành công đi so như thể đó là lỗi.
 */
const noError = (): never => {
  throw new Error("Mong đợi lỗi nhưng thao tác lại thành công");
};

/** Bắt lỗi nghiệp vụ để kiểm cả loại lẫn `code`/thông điệp. */
const caught = (error: unknown) => error as Error & { code?: string };

const EXISTING = { id: "r-EDITOR", isSystem: false, level: 10, _count: { userRoles: 0 } };

const baseCreate = {
  key: "EDITOR",
  name: "Biên tập viên",
  level: 10,
  permissions: ["user:read"],
};

describe("RoleService", () => {
  describe("list", () => {
    it("làm phẳng quyền thành mảng khoá và đếm số người đang mang vai trò", async () => {
      // Màn phân quyền chỉ cần khoá để tick ô và số người để cảnh báo trước
      // khi xoá — trả nguyên cấu trúc lồng của Prisma thì UI phải tự gỡ.
      const { db } = createDb({
        role: {
          findMany: vi
            .fn()
            .mockResolvedValue([roleRow("ADMIN", 50, ["user:read", "role:read"], 3)]),
        },
      });

      const [role] = await new RoleService(db, createPermissions().permissions).list();

      expect(role).toMatchObject({ key: "ADMIN", permissions: ["user:read", "role:read"] });
      expect(role!.userCount).toBe(3);
      expect(role).not.toHaveProperty("_count");
    });

    it("sắp theo bậc GIẢM DẦN rồi theo khoá", async () => {
      // Thứ tự là hợp đồng với giao diện: người đọc bảng phân quyền đi từ vai
      // trò mạnh nhất xuống, giống sơ đồ tổ chức.
      const { db, raw } = createDb();

      await new RoleService(db, createPermissions().permissions).list();

      expect(argOf(raw.role.findMany).orderBy).toEqual([{ level: "desc" }, { key: "asc" }]);
    });
  });

  describe("findByKey", () => {
    it("trả đúng vai trò theo khoá", async () => {
      const { db } = createDb({
        role: {
          findMany: vi.fn().mockResolvedValue([roleRow("ADMIN", 50), roleRow("EDITOR", 10)]),
        },
      });

      const role = await new RoleService(db, createPermissions().permissions).findByKey("EDITOR");

      expect(role.level).toBe(10);
    });

    it("báo RoleNotFoundError khi không có — không trả undefined", async () => {
      // Trả undefined thì tầng trên dễ coi như "không có quyền gì" và đi tiếp;
      // một lỗi NOT_FOUND rõ ràng mới thành 404 đúng nghĩa.
      const { db } = createDb();

      await expect(
        new RoleService(db, createPermissions().permissions).findByKey("GHOST"),
      ).rejects.toBeInstanceOf(RoleNotFoundError);
    });
  });

  describe("create", () => {
    it("ghi vai trò kèm quyền và XOÁ cache quyền", async () => {
      // Cache quyền sống 60 giây: quên xoá thì người quản trị tạo vai trò, gán
      // ngay, và người được gán chưa dùng được quyền mới — trông như hệ thống hỏng.
      const { db, raw } = createDb();
      const { permissions, invalidateAll } = createPermissions();

      const role = await new RoleService(db, permissions).create(baseCreate, SYSTEM);

      expect(argOf(raw.role.create).data).toMatchObject({
        key: "EDITOR",
        level: 10,
        description: null,
        permissions: { create: [{ permissionId: "p-user-read" }] },
      });
      expect(invalidateAll).toHaveBeenCalledTimes(1);
      expect(role.key).toBe("EDITOR");
    });

    it("LUÔN tạo isSystem = false, kể cả khi input lén gửi true", async () => {
      // Vai trò hệ thống không xoá được và không có nút gỡ — chỉ `db:seed` được
      // tạo. Để API đặt cờ này là mở đường tạo rác vĩnh viễn.
      const { db, raw } = createDb();

      await new RoleService(db, createPermissions().permissions).create(
        {
          ...baseCreate,
          isSystem: true,
        } as typeof baseCreate,
        SYSTEM,
      );

      expect(argOf(raw.role.create).data).toMatchObject({ isSystem: false });
    });

    it("chấp nhận danh sách quyền rỗng mà không hỏi database", async () => {
      const { db, raw } = createDb();

      await new RoleService(db, createPermissions().permissions).create(
        {
          ...baseCreate,
          description: "Mô tả",
          permissions: [],
        },
        SYSTEM,
      );

      expect(raw.permission.findMany).not.toHaveBeenCalled();
      expect(argOf(raw.role.create).data).toMatchObject({
        description: "Mô tả",
        permissions: { create: [] },
      });
    });

    it("trùng khoá → RoleKeyAlreadyExistsError (CONFLICT), không ghi gì", async () => {
      // Phải là lỗi nghiệp vụ 409 có thông điệp, không phải để Prisma ném P2002
      // rồi lọt ra thành 500.
      const { db, raw } = createDb({
        role: { findUnique: vi.fn().mockResolvedValue({ id: "r-EDITOR" }) },
      });
      const { permissions, invalidateAll } = createPermissions();

      const error = await new RoleService(db, permissions)
        .create(baseCreate, SYSTEM)
        .then(noError, caught);

      expect(error).toBeInstanceOf(RoleKeyAlreadyExistsError);
      expect(error.code).toBe("CONFLICT");
      expect(raw.role.create).not.toHaveBeenCalled();
      expect(invalidateAll).not.toHaveBeenCalled();
    });

    it("từ chối khoá quyền KHÔNG có trong code, trước khi đụng database", async () => {
      // Khoá gõ sai mà lọt vào thì ô tick hiện "đã cấp" nhưng không guard nào
      // kiểm tra nó — người quản trị tưởng đã phân quyền xong.
      const { db, raw } = createDb();

      const error = await new RoleService(db, createPermissions().permissions)
        .create({ ...baseCreate, permissions: ["user:read", "user:fly"] }, SYSTEM)
        .then(noError, caught);

      expect(error).toBeInstanceOf(UnknownPermissionError);
      expect(error.message).toContain("user:fly");
      expect(error.message).not.toContain("user:read");
      expect(raw.permission.findMany).not.toHaveBeenCalled();
      expect(raw.role.create).not.toHaveBeenCalled();
    });

    it("từ chối khoá có trong code nhưng CHƯA seed vào database", async () => {
      // Quên `pnpm db:seed` thì nói thẳng, thay vì để quyền được tick mà không
      // được ghi.
      const { db, raw } = createDb();

      const error = await new RoleService(db, createPermissions().permissions)
        .create({ ...baseCreate, permissions: ["user:read", "audit:read"] }, SYSTEM)
        .then(noError, caught);

      expect(error).toBeInstanceOf(UnknownPermissionError);
      expect(error.message).toContain("audit:read");
      expect(raw.role.create).not.toHaveBeenCalled();
    });

    it("chặn tạo vai trò NGANG bậc người tạo — chặn đường tự phong", async () => {
      // Không có chốt này thì ADMIN (50) tạo vai trò bậc 50/99 rồi tự gán, đi
      // vòng qua chính luật cấm gán SUPER_ADMIN.
      const { db, raw } = createDb({}, { admin: [50] });

      await expect(
        new RoleService(db, createPermissions().permissions).create(
          { ...baseCreate, level: 50 },
          { actorId: "admin" },
        ),
      ).rejects.toBeInstanceOf(InsufficientRoleLevelError);
      expect(raw.role.create).not.toHaveBeenCalled();
    });

    it("lấy bậc CAO NHẤT trong các vai trò của người tạo", async () => {
      // Người mang nhiều vai trò được đối xử theo vai trò mạnh nhất — lấy vai
      // trò đầu tiên thì kết quả phụ thuộc thứ tự trả về của database.
      const { db, raw } = createDb({}, { mixed: [10, 50] });

      await new RoleService(db, createPermissions().permissions).create(
        { ...baseCreate, level: 49 },
        { actorId: "mixed" },
      );

      expect(raw.role.create).toHaveBeenCalledTimes(1);
    });

    it("người không có vai trò nào không tạo được kể cả vai trò bậc 0", async () => {
      // Không vai trò = bậc -1: mọi bậc hợp lệ (≥ 0) đều không quản lý được.
      const { db } = createDb();

      await expect(
        new RoleService(db, createPermissions().permissions).create(
          { ...baseCreate, level: 0 },
          { actorId: "nobody" },
        ),
      ).rejects.toBeInstanceOf(InsufficientRoleLevelError);
    });

    it("không có actorId (seed/hệ thống) thì bỏ qua kiểm tra bậc", async () => {
      const { db, raw } = createDb();

      await new RoleService(db, createPermissions().permissions).create(
        { ...baseCreate, level: 100 },
        { actorId: null },
      );

      expect(raw.userRole.findMany).not.toHaveBeenCalled();
      expect(raw.role.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("update", () => {
    it("chỉ ghi field được gửi lên và XOÁ cache quyền", async () => {
      // Đổi tên mà ghi đè luôn level/description bằng undefined là xoá dữ liệu
      // người ta không hề đụng tới.
      const { db, tx } = createDb({ role: { findUnique: vi.fn().mockResolvedValue(EXISTING) } });
      const { permissions, invalidateAll } = createPermissions();

      await new RoleService(db, permissions).update("EDITOR", { name: "Tên mới" }, SYSTEM);

      expect(argOf(tx.role.update)).toEqual({
        where: { id: "r-EDITOR" },
        data: { name: "Tên mới" },
      });
      // Không gửi `permissions` = không đụng tới bảng phân quyền.
      expect(tx.rolePermission.deleteMany).not.toHaveBeenCalled();
      expect(invalidateAll).toHaveBeenCalledTimes(1);
    });

    it("ghi cả description và level khi có gửi", async () => {
      const { db, tx } = createDb({ role: { findUnique: vi.fn().mockResolvedValue(EXISTING) } });

      await new RoleService(db, createPermissions().permissions).update(
        "EDITOR",
        {
          description: "Mô tả",
          level: 20,
        },
        SYSTEM,
      );

      expect(argOf(tx.role.update).data).toEqual({ description: "Mô tả", level: 20 });
    });

    it("đổi quyền là THAY THẾ toàn bộ và XOÁ cache quyền", async () => {
      // Bỏ tick phải gỡ được quyền thật; và gỡ quyền mà cache còn giữ 60 giây
      // là 60 giây người bị tước vẫn làm được việc — một lỗ hổng.
      const { db, tx } = createDb({ role: { findUnique: vi.fn().mockResolvedValue(EXISTING) } });
      const { permissions, invalidateAll } = createPermissions();

      await new RoleService(db, permissions).update(
        "EDITOR",
        {
          permissions: ["user:read", "role:read"],
        },
        SYSTEM,
      );

      expect(tx.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: "r-EDITOR" } });
      expect(argOf(tx.rolePermission.createMany).data).toEqual([
        { roleId: "r-EDITOR", permissionId: "p-user-read" },
        { roleId: "r-EDITOR", permissionId: "p-role-read" },
      ]);
      expect(invalidateAll).toHaveBeenCalledTimes(1);
    });

    it("danh sách quyền RỖNG nghĩa là gỡ hết, không phải bỏ qua", async () => {
      // `[]` và "không gửi" là hai ý khác nhau: bỏ tick ô cuối cùng phải thực
      // sự để vai trò trắng quyền.
      const { db, tx } = createDb({ role: { findUnique: vi.fn().mockResolvedValue(EXISTING) } });
      const { permissions, invalidateAll } = createPermissions();

      await new RoleService(db, permissions).update("EDITOR", { permissions: [] }, SYSTEM);

      expect(tx.rolePermission.deleteMany).toHaveBeenCalledTimes(1);
      expect(tx.rolePermission.createMany).not.toHaveBeenCalled();
      expect(invalidateAll).toHaveBeenCalledTimes(1);
    });

    it("từ chối khoá quyền không tồn tại và KHÔNG mở transaction", async () => {
      // Kiểm tra trước khi ghi: lỗi giữa chừng mà bảng phân quyền đã bị xoá
      // sạch thì vai trò mất hết quyền vì một lỗi gõ.
      const { db, raw } = createDb({ role: { findUnique: vi.fn().mockResolvedValue(EXISTING) } });
      const { permissions, invalidateAll } = createPermissions();

      await expect(
        new RoleService(db, permissions).update("EDITOR", { permissions: ["role:fly"] }, SYSTEM),
      ).rejects.toBeInstanceOf(UnknownPermissionError);
      expect(raw.$transaction).not.toHaveBeenCalled();
      expect(invalidateAll).not.toHaveBeenCalled();
    });

    it("vai trò không tồn tại → RoleNotFoundError", async () => {
      const { db } = createDb();

      await expect(
        new RoleService(db, createPermissions().permissions).update("GHOST", { name: "x" }, SYSTEM),
      ).rejects.toBeInstanceOf(RoleNotFoundError);
    });

    it("chặn sửa vai trò MẠNH HƠN hoặc ngang mình (bậc hiện tại)", async () => {
      // MANAGER (20) mà sửa được ADMIN (50) thì tự thêm quyền cho ADMIN rồi
      // nhờ ai đó gán — hoặc hạ nó xuống bậc mình rồi tự gán.
      const { db, raw } = createDb(
        { role: { findUnique: vi.fn().mockResolvedValue({ ...EXISTING, level: 50 }) } },
        { manager: [20] },
      );

      await expect(
        new RoleService(db, createPermissions().permissions).update(
          "ADMIN",
          { level: 10 },
          { actorId: "manager" },
        ),
      ).rejects.toBeInstanceOf(InsufficientRoleLevelError);
      expect(raw.$transaction).not.toHaveBeenCalled();
    });

    it("chặn NÂNG vai trò yếu hơn lên ngang/vượt mình (bậc mới)", async () => {
      // Sửa được vai trò bậc 10 không có nghĩa được đẩy nó lên bậc 99.
      const { db, raw } = createDb(
        { role: { findUnique: vi.fn().mockResolvedValue(EXISTING) } },
        { admin: [50] },
      );

      await expect(
        new RoleService(db, createPermissions().permissions).update(
          "EDITOR",
          { level: 50 },
          { actorId: "admin" },
        ),
      ).rejects.toBeInstanceOf(InsufficientRoleLevelError);
      expect(raw.$transaction).not.toHaveBeenCalled();
    });

    it("cho sửa vai trò yếu hơn khi bậc mới vẫn dưới mình", async () => {
      const { db, tx } = createDb(
        { role: { findUnique: vi.fn().mockResolvedValue(EXISTING) } },
        { admin: [50] },
      );

      await new RoleService(db, createPermissions().permissions).update(
        "EDITOR",
        { level: 49 },
        { actorId: "admin" },
      );

      expect(tx.role.update).toHaveBeenCalledTimes(1);
    });
  });

  describe("remove", () => {
    it("xoá vai trò không còn ai mang và XOÁ cache quyền", async () => {
      const { db, raw } = createDb({ role: { findUnique: vi.fn().mockResolvedValue(EXISTING) } });
      const { permissions, invalidateAll } = createPermissions();

      await new RoleService(db, permissions).remove("EDITOR", SYSTEM);

      expect(raw.role.delete).toHaveBeenCalledWith({ where: { id: "r-EDITOR" } });
      expect(invalidateAll).toHaveBeenCalledTimes(1);
    });

    it("KHÔNG xoá được vai trò hệ thống", async () => {
      // USER/ADMIN/SUPER_ADMIN là thứ code giả định luôn tồn tại (vai trò mặc
      // định khi đăng ký, quyền seed…). Xoá đi là hỏng ở chỗ không ai ngờ.
      const { db, raw } = createDb({
        role: { findUnique: vi.fn().mockResolvedValue({ ...EXISTING, isSystem: true }) },
      });
      const { permissions, invalidateAll } = createPermissions();

      const error = await new RoleService(db, permissions)
        .remove("USER", SYSTEM)
        .then(noError, caught);

      expect(error).toBeInstanceOf(SystemRoleImmutableError);
      expect(error.code).toBe("CONFLICT");
      expect(raw.role.delete).not.toHaveBeenCalled();
      expect(invalidateAll).not.toHaveBeenCalled();
    });

    it("chặn xoá vai trò còn người mang — không cascade âm thầm", async () => {
      // Cascade sẽ tước quyền của mọi người mang vai trò này mà không ai được
      // báo, và không có gì hoàn tác được.
      const { db, raw } = createDb({
        role: {
          findUnique: vi.fn().mockResolvedValue({ ...EXISTING, _count: { userRoles: 4 } }),
        },
      });

      const error = await new RoleService(db, createPermissions().permissions)
        .remove("EDITOR", SYSTEM)
        .then(noError, caught);

      expect(error).toBeInstanceOf(RoleInUseError);
      expect(error.message).toContain("4");
      expect(raw.role.delete).not.toHaveBeenCalled();
    });

    it("chặn xoá vai trò ngang/trên bậc người xoá", async () => {
      const { db, raw } = createDb(
        { role: { findUnique: vi.fn().mockResolvedValue({ ...EXISTING, level: 50 }) } },
        { admin: [50] },
      );

      await expect(
        new RoleService(db, createPermissions().permissions).remove("PEER", { actorId: "admin" }),
      ).rejects.toBeInstanceOf(InsufficientRoleLevelError);
      expect(raw.role.delete).not.toHaveBeenCalled();
    });

    it("vai trò không tồn tại → RoleNotFoundError", async () => {
      const { db } = createDb();

      await expect(
        new RoleService(db, createPermissions().permissions).remove("GHOST", SYSTEM),
      ).rejects.toBeInstanceOf(RoleNotFoundError);
    });
  });

  describe("listPermissions", () => {
    it("trả danh mục quyền sắp theo nhóm rồi theo khoá", async () => {
      // Màn phân quyền vẽ theo nhóm: sai thứ tự là các ô tick của cùng một
      // nhóm bị xé ra nhiều chỗ.
      const rows = [{ key: "user:read", name: "Xem", category: "Người dùng", description: null }];
      const { db, raw } = createDb({ permission: { findMany: vi.fn().mockResolvedValue(rows) } });

      const result = await new RoleService(db, createPermissions().permissions).listPermissions();

      expect(result).toBe(rows);
      expect(argOf(raw.permission.findMany).orderBy).toEqual([{ category: "asc" }, { key: "asc" }]);
    });
  });
});
