import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_METADATA,
  SYSTEM_ROLES,
  isKnownPermission,
  resolveSeedPermissions,
} from "./permissions";

/**
 * Danh mục quyền là nguồn sự thật cho seed và cho việc lọc dữ liệu đọc lên từ
 * database. Sai ở đây thì sai lan ra cả hệ thống, nên nó phải tự nhất quán.
 */

describe("danh mục PERMISSIONS", () => {
  it("không có tên quyền trùng nhau", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it("mọi quyền đều theo quy ước <tài-nguyên>:<hành-động>", () => {
    for (const permission of PERMISSIONS) {
      expect(permission, `sai quy ước: ${permission}`).toMatch(/^[a-z]+:[a-z]+(:own)?$/);
    }
  });

  it("mọi quyền đều có mô tả hiển thị", () => {
    // Thiếu mô tả thì giao diện phân quyền hiện ra một ô trống, và người quản
    // trị phải đoán xem mình đang tick vào cái gì.
    for (const permission of PERMISSIONS) {
      expect(
        PERMISSION_METADATA[permission].description,
        `thiếu mô tả: ${permission}`,
      ).toBeTruthy();
    }
  });
});

describe("isKnownPermission", () => {
  it("nhận quyền có trong danh mục", () => {
    expect(isKnownPermission("user:read")).toBe(true);
  });

  it("từ chối chuỗi lạ", () => {
    // Đây là lớp chặn bản ghi còn sót trong database sau khi một quyền bị xoá
    // khỏi code. Không có nó, dòng cũ vẫn cấp quyền mà không mã nào kiểm tra.
    expect(isKnownPermission("user:destroy")).toBe(false);
    expect(isKnownPermission("")).toBe(false);
  });
});

function seedFor(key: string) {
  const seed = DEFAULT_ROLE_PERMISSIONS.find((role) => role.key === key);
  if (!seed) throw new Error(`Thiếu vai trò seed: ${key}`);
  return seed;
}

describe("DEFAULT_ROLE_PERMISSIONS", () => {
  it("có đủ mọi vai trò hệ thống khai trong SYSTEM_ROLES", () => {
    // Khai trong `SYSTEM_ROLES` mà quên seed thì code tham chiếu tới vai trò
    // đó vẫn biên dịch được, nhưng lúc chạy tra database sẽ không thấy gì.
    const keys = DEFAULT_ROLE_PERMISSIONS.map((role) => role.key);

    for (const key of Object.values(SYSTEM_ROLES)) {
      expect(keys, `thiếu seed cho vai trò ${key}`).toContain(key);
    }
  });

  it("mọi quyền được gán đều nằm trong danh mục", () => {
    for (const role of DEFAULT_ROLE_PERMISSIONS) {
      for (const permission of resolveSeedPermissions(role)) {
        expect(PERMISSIONS, `${role.key} gán quyền lạ: ${permission}`).toContain(permission);
      }
    }
  });

  it("không vai trò nào bị gán trùng một quyền hai lần", () => {
    for (const role of DEFAULT_ROLE_PERMISSIONS) {
      const permissions = resolveSeedPermissions(role);
      expect(new Set(permissions).size, `${role.key} có quyền lặp`).toBe(permissions.length);
    }
  });

  it('SUPER_ADMIN dùng "*" và giải ra ĐÚNG toàn bộ danh mục', () => {
    const superAdmin = seedFor(SYSTEM_ROLES.SUPER_ADMIN);

    // Liệt kê tay thì mỗi lần thêm quyền mới lại phải nhớ bổ sung — quên một
    // lần là SUPER_ADMIN mất quyền đó mà không ai để ý cho tới lúc cần dùng.
    expect(superAdmin.permissions).toBe("*");
    expect(resolveSeedPermissions(superAdmin)).toEqual(PERMISSIONS);
  });

  it("USER chỉ chạm được dữ liệu của chính mình", () => {
    /*
     * `notification:read` KHÔNG có hậu tố `:own` nhưng vẫn hợp lệ: service
     * thông báo luôn lọc theo `userId` của người đang đăng nhập, không có
     * đường nào đọc hộp thư của người khác.
     *
     * Thứ phải chặn là các quyền chạm tới dữ liệu NGƯỜI KHÁC — quản lý người
     * dùng, phân quyền, nhật ký, gửi thông báo cho người khác.
     */
    const forbidden = ["user:", "role:", "audit:"];

    for (const permission of resolveSeedPermissions(seedFor(SYSTEM_ROLES.USER))) {
      for (const prefix of forbidden) {
        expect(permission.startsWith(prefix), `USER không được có ${permission}`).toBe(false);
      }
      expect(permission, "USER không được gửi thông báo cho người khác").not.toBe(
        "notification:send",
      );
    }
  });

  it("bậc quyền lực (level) không trùng nhau và tăng dần theo độ mạnh", () => {
    // `Role.level` là thứ chặn leo thang đặc quyền: `assertCanActOn` từ chối
    // khi mục tiêu có level ≥ level của người thao tác. Hai vai trò cùng level
    // nghĩa là chúng thao tác được lên nhau — gần như luôn là nhầm.
    const levels = DEFAULT_ROLE_PERMISSIONS.map((role) => role.level);

    expect(new Set(levels).size, "có hai vai trò trùng level").toBe(levels.length);
    expect(seedFor(SYSTEM_ROLES.SUPER_ADMIN).level).toBeGreaterThan(
      seedFor(SYSTEM_ROLES.ADMIN).level,
    );
    expect(seedFor(SYSTEM_ROLES.USER).level).toBe(0);
  });

  it("vai trò level cao hơn có đủ mọi quyền của vai trò ngay dưới nó", () => {
    /*
     * Ràng buộc thật sự quan trọng.
     *
     * `Role.level` nói "vai trò này mạnh hơn", còn bảng quyền mới là thứ quyết
     * định làm được gì. Nếu hai thứ lệch nhau — MANAGER level 20 nhưng thiếu
     * một quyền mà STAFF level 10 có — thì admin sẽ thăng cấp cho ai đó và vô
     * tình lấy mất quyền của họ.
     */
    const ordered = [...DEFAULT_ROLE_PERMISSIONS].sort((a, b) => a.level - b.level);

    for (let index = 1; index < ordered.length; index += 1) {
      const lower = resolveSeedPermissions(ordered[index - 1]!);
      const higher = new Set(resolveSeedPermissions(ordered[index]!));

      for (const permission of lower) {
        expect(
          higher.has(permission),
          `${ordered[index]!.key} (level ${ordered[index]!.level}) thiếu ${permission} mà ${ordered[index - 1]!.key} có`,
        ).toBe(true);
      }
    }
  });
});
