import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PermissionService } from "./permission.service";
import { __clearCache } from "@/lib/cache";

/**
 * Không cần database thật: chỉ giả lập đúng một truy vấn mà service gọi.
 *
 * Kiểu `PrismaClient` được ép ở biên — bên trong test ta chỉ khai những field
 * thực sự được đọc, thay vì dựng một bản sao đầy đủ của Prisma.
 */
function createDb(user: unknown) {
  return {
    user: { findFirst: vi.fn().mockResolvedValue(user) },
  } as unknown as PrismaClient;
}

const roleWith = (...keys: string[]) => ({
  role: { permissions: keys.map((key) => ({ permission: { key } })) },
});

describe("PermissionService", () => {
  beforeEach(async () => {
    // Cache dùng chung giữa các test — không dọn thì test sau đọc kết quả của
    // test trước và pass/fail theo thứ tự chạy.
    await __clearCache();
  });

  it("gộp quyền từ NHIỀU vai trò", async () => {
    const db = createDb({
      userRoles: [roleWith("user:read"), roleWith("role:read", "audit:read")],
      userPermissions: [],
    });

    const permissions = await new PermissionService(db).permissionsFor("u1");

    expect([...permissions].sort()).toEqual(["audit:read", "role:read", "user:read"]);
  });

  it("quyền cấp riêng cho cá nhân được cộng thêm", async () => {
    const db = createDb({
      userRoles: [roleWith("user:read")],
      userPermissions: [{ isGranted: true, permission: { key: "user:delete" } }],
    });

    const service = new PermissionService(db);

    expect(await service.can("u1", "user:delete")).toBe(true);
  });

  it("TƯỚC quyền cá nhân thắng mọi vai trò", async () => {
    // Đây là luật quan trọng nhất của lớp này: cần chặn gấp một người khỏi một
    // hành động thì phải chặn được ngay, không phải đi dựng lại vai trò.
    const db = createDb({
      userRoles: [roleWith("user:read", "user:delete")],
      userPermissions: [{ isGranted: false, permission: { key: "user:delete" } }],
    });

    const service = new PermissionService(db);

    expect(await service.can("u1", "user:read")).toBe(true);
    expect(await service.can("u1", "user:delete")).toBe(false);
  });

  it("bỏ qua quyền không còn tồn tại trong code", async () => {
    // Một dòng cũ sót lại trong database không được phép cấp quyền, vì không
    // còn dòng mã nào kiểm tra nó.
    const db = createDb({
      userRoles: [roleWith("user:read", "quyen:da:bi:xoa")],
      userPermissions: [],
    });

    const permissions = await new PermissionService(db).permissionsFor("u1");

    expect([...permissions]).toEqual(["user:read"]);
  });

  it("người dùng không tồn tại có tập quyền rỗng, không ném lỗi", async () => {
    const service = new PermissionService(createDb(null));

    expect([...(await service.permissionsFor("khong-co"))]).toEqual([]);
    expect(await service.can("khong-co", "user:read")).toBe(false);
  });

  it("canAll cần đủ mọi quyền, canAny chỉ cần một", async () => {
    const db = createDb({ userRoles: [roleWith("user:read")], userPermissions: [] });
    const service = new PermissionService(db);

    expect(await service.canAny("u1", ["user:read", "user:delete"])).toBe(true);
    expect(await service.canAll("u1", ["user:read", "user:delete"])).toBe(false);
  });

  it("cache: lần gọi thứ hai không chạm database nữa", async () => {
    const db = createDb({ userRoles: [roleWith("user:read")], userPermissions: [] });
    const service = new PermissionService(db);

    await service.permissionsFor("u1");
    await service.permissionsFor("u1");

    expect(db.user.findFirst).toHaveBeenCalledTimes(1);
  });

  it("invalidateUser buộc lần sau đọc lại từ database", async () => {
    // Quên gọi hàm này sau khi đổi vai trò thì thay đổi chỉ có hiệu lực sau khi
    // TTL hết — người quản trị thử lại ngay, thấy chưa đổi, và tưởng hỏng.
    const db = createDb({ userRoles: [roleWith("user:read")], userPermissions: [] });
    const service = new PermissionService(db);

    await service.permissionsFor("u1");
    await service.invalidateUser("u1");
    await service.permissionsFor("u1");

    expect(db.user.findFirst).toHaveBeenCalledTimes(2);
  });

  it("lọc ngoại lệ ĐÃ HẾT HẠN ngay trong truy vấn", async () => {
    /*
     * Lọc ở tầng database chứ không ở tầng ứng dụng: mọi nơi hỏi "người này có
     * quyền gì" đều đi qua đúng câu truy vấn này, nên không có đường nào quên.
     *
     * Một quyền tạm còn hiệu lực sau khi hết hạn là đúng thứ mà cột `expiresAt`
     * sinh ra để ngăn — và nó hỏng trong im lặng, không ai phát hiện cho tới
     * lúc kiểm toán.
     */
    const db = createDb({ userRoles: [], userPermissions: [] });

    await new PermissionService(db).permissionsFor("u1");

    const args = vi.mocked(db.user.findFirst).mock.calls[0]![0]! as {
      select: { userPermissions: { where: unknown } };
    };

    expect(args.select.userPermissions.where).toEqual({
      OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
    });
  });

  it("explainFor: nói rõ quyền đến từ ĐÂU", async () => {
    /*
     * `permissionsFor()` trả lời "được làm gì" — đủ để quyết định, không đủ để
     * GIẢI THÍCH. Khi có ngoại lệ cá nhân, câu hỏi thật của bộ phận hỗ trợ là
     * "vì sao tài khoản này xoá được người dùng?".
     */
    const db = createDb({
      userRoles: [
        { role: { key: "ADMIN", permissions: [{ permission: { key: "user:read" } }] } },
        { role: { key: "STAFF", permissions: [{ permission: { key: "user:read" } }] } },
      ],
      userPermissions: [
        {
          isGranted: true,
          grantedBy: "admin-1",
          expiresAt: null,
          permission: { key: "user:delete" },
        },
        {
          isGranted: false,
          grantedBy: "admin-1",
          expiresAt: null,
          permission: { key: "audit:read" },
        },
      ],
    });

    const explain = await new PermissionService(db).explainFor("u1");
    const byKey = new Map(explain.map((item) => [item.key, item]));

    // Đến từ hai vai trò — giữ CẢ HAI, vì "gỡ vai trò nào thì mất quyền này"
    // là câu hỏi tiếp theo của người tra.
    expect(byKey.get("user:read")).toMatchObject({
      source: "role",
      roles: ["ADMIN", "STAFF"],
    });

    expect(byKey.get("user:delete")).toMatchObject({ source: "grant", grantedBy: "admin-1" });
    expect(byKey.get("audit:read")).toMatchObject({ source: "denied" });
  });

  it("explainFor: ngoại lệ HẾT HẠN không còn đè lên vai trò", async () => {
    // Quyền quay về đúng những gì vai trò cho, nhưng vẫn ghi nhận "đã từng cấp"
    // để người tra hiểu vì sao có dấu vết trong nhật ký.
    const db = createDb({
      userRoles: [{ role: { key: "USER", permissions: [{ permission: { key: "user:read" } }] } }],
      userPermissions: [
        {
          isGranted: false,
          grantedBy: "admin-1",
          expiresAt: new Date(Date.now() - 1000),
          permission: { key: "user:read" },
        },
      ],
    });

    const explain = await new PermissionService(db).explainFor("u1");

    expect(explain[0]).toMatchObject({
      key: "user:read",
      source: "role",
      expiredOverride: true,
    });
  });

  it("canActOnResource: quyền ':own' chỉ áp dụng cho dữ liệu của chính mình", async () => {
    const db = createDb({
      userRoles: [roleWith("profile:update:own")],
      userPermissions: [],
    });
    const service = new PermissionService(db);
    const rule = { any: "user:update", own: "profile:update:own" } as const;

    expect(await service.canActOnResource("u1", "u1", rule)).toBe(true);
    expect(await service.canActOnResource("u1", "nguoi-khac", rule)).toBe(false);
  });
});
