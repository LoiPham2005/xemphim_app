import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { permissionService } from "./permission.service";
import { isKnownPermission } from "@/lib/permissions";
import { type CreateRoleInput, type Role, type UpdateRoleInput } from "@/schemas/role.schema";
import {
  InsufficientRoleLevelError,
  RoleInUseError,
  RoleKeyAlreadyExistsError,
  RoleNotFoundError,
  SystemRoleImmutableError,
  UnknownPermissionError,
} from "@/lib/errors";
import type { PermissionService } from "./permission.service";

/**
 * Quản trị vai trò và bảng phân quyền.
 *
 * MỌI thao tác ghi ở đây đều gọi `permissions.invalidateAll()`. Quên một chỗ
 * thì thay đổi chỉ có hiệu lực sau khi cache hết hạn — người quản trị bỏ tick
 * một quyền, thử lại ngay, thấy vẫn làm được, và kết luận là hệ thống hỏng.
 */
/**
 * Ai đang thao tác — BẮT BUỘC ở mọi đường ghi vai trò. `null` = hệ thống (seed, script), được bỏ qua
 * chốt chặn theo `level`.
 *
 * Trước đây là `{ actorId?: ... } = {}` (tuỳ chọn): KHÔNG một nơi gọi nào truyền, nên chốt chặn leo
 * thang luôn cho qua — ADMIN có `role:create` tạo được vai trò bậc 999 hay sửa thẳng SUPER_ADMIN rồi tự
 * gán. Bắt buộc ở tầng kiểu để quên là không biên dịch được, cùng tinh thần với `defineAction`.
 */
export type RoleActor = { actorId: string | null };

export class RoleService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly permissions: PermissionService = permissionService,
  ) {}

  /** Đổi khoá quyền thành id, từ chối nếu có khoá không có trong code. */
  private async resolvePermissionIds(keys: readonly string[]): Promise<string[]> {
    if (keys.length === 0) return [];

    const unknown = keys.filter((key) => !isKnownPermission(key));
    if (unknown.length > 0) throw new UnknownPermissionError(unknown);

    const rows = await this.db.permission.findMany({
      where: { key: { in: [...keys] } },
      select: { id: true, key: true },
    });

    // Có trong code nhưng thiếu trong database = quên chạy `pnpm db:seed`.
    // Nói thẳng còn hơn để người dùng tick xong mà quyền không được ghi.
    const found = new Set(rows.map((row) => row.key));
    const missing = keys.filter((key) => !found.has(key));
    if (missing.length > 0) throw new UnknownPermissionError(missing);

    return rows.map((row) => row.id);
  }

  /**
   * Bậc cao nhất trong số các vai trò của một người. Không có vai trò nào → -1.
   *
   * Lặp lại logic của `UserService.maxRoleLevel` — hai service không phụ thuộc
   * nhau, và một truy vấn năm dòng thì rẻ hơn một mối phụ thuộc vòng.
   */
  private async maxRoleLevel(userId: string): Promise<number> {
    const rows = await this.db.userRole.findMany({
      where: { userId },
      select: { role: { select: { level: true } } },
    });

    return rows.reduce((max, row) => Math.max(max, row.role.level), -1);
  }

  /**
   * Chặn tạo/sửa/xoá một vai trò MẠNH HƠN HOẶC BẰNG bậc của chính mình.
   *
   * Không có chốt này thì `Role.level` chỉ là trang trí: một ADMIN bị chặn
   * không gán được vai trò SUPER_ADMIN, nhưng lại tạo được một vai trò mới ở
   * bậc 999 rồi tự gán — đi vòng qua đúng thứ vừa dựng lên để chặn.
   */
  private async assertCanManageLevel(
    actorId: string | null | undefined,
    level: number,
  ): Promise<void> {
    if (!actorId) return;

    if (level >= (await this.maxRoleLevel(actorId))) {
      throw new InsufficientRoleLevelError(
        `Bạn không đủ thẩm quyền để quản lý vai trò ở bậc ${level}`,
      );
    }
  }

  async list(): Promise<Role[]> {
    const rows = await this.db.role.findMany({
      // Sắp theo bậc GIẢM DẦN: màn phân quyền đọc từ mạnh xuống yếu, giống
      // cách người ta hình dung sơ đồ tổ chức.
      orderBy: [{ level: "desc" }, { key: "asc" }],
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        level: true,
        isSystem: true,
        createdAt: true,
        updatedAt: true,
        permissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { userRoles: true } },
      },
    });

    return rows.map(({ permissions, _count, ...rest }) => ({
      ...rest,
      permissions: permissions.map((item) => item.permission.key),
      userCount: _count.userRoles,
    }));
  }

  async findByKey(key: string): Promise<Role> {
    const roles = await this.list();
    const role = roles.find((item) => item.key === key);
    if (!role) throw new RoleNotFoundError(key);
    return role;
  }

  async create(input: CreateRoleInput, options: RoleActor): Promise<Role> {
    const existing = await this.db.role.findUnique({ where: { key: input.key } });
    if (existing) throw new RoleKeyAlreadyExistsError(input.key);

    await this.assertCanManageLevel(options.actorId, input.level);

    const permissionIds = await this.resolvePermissionIds(input.permissions);

    await this.db.role.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        level: input.level,
        // `isSystem` KHÔNG đọc từ input: vai trò hệ thống là thứ chỉ `db:seed`
        // được tạo. Cho phép đặt qua API là mở đường tạo một vai trò không xoá
        // được, và không có nút nào gỡ nó ra.
        isSystem: false,
        permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
      },
    });

    await this.permissions.invalidateAll();
    return this.findByKey(input.key);
  }

  async update(key: string, input: UpdateRoleInput, options: RoleActor): Promise<Role> {
    const role = await this.db.role.findUnique({
      where: { key },
      select: { id: true, isSystem: true, level: true },
    });
    if (!role) throw new RoleNotFoundError(key);

    // Bậc HIỆN TẠI: không cho sửa một vai trò mạnh hơn mình…
    await this.assertCanManageLevel(options.actorId, role.level);
    // …và bậc MỚI: không cho nâng nó lên ngang/vượt mình.
    if (input.level !== undefined) await this.assertCanManageLevel(options.actorId, input.level);

    const permissionIds = input.permissions
      ? await this.resolvePermissionIds(input.permissions)
      : null;

    await this.db.$transaction(async (tx) => {
      await tx.role.update({
        where: { id: role.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.level !== undefined ? { level: input.level } : {}),
        },
      });

      if (permissionIds) {
        // Thay thế toàn bộ — xem ghi chú ở `updateRoleSchema`.
        await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
        if (permissionIds.length > 0) {
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
          });
        }
      }
    });

    await this.permissions.invalidateAll();
    return this.findByKey(key);
  }

  async remove(key: string, options: RoleActor): Promise<void> {
    const role = await this.db.role.findUnique({
      where: { key },
      select: { id: true, isSystem: true, level: true, _count: { select: { userRoles: true } } },
    });
    if (!role) throw new RoleNotFoundError(key);

    if (role.isSystem) throw new SystemRoleImmutableError(key);

    await this.assertCanManageLevel(options.actorId, role.level);

    // Chặn thay vì cascade: xoá vai trò đang được dùng sẽ âm thầm tước quyền
    // của tất cả những người mang nó, và không có gì hoàn tác được.
    if (role._count.userRoles > 0) throw new RoleInUseError(key, role._count.userRoles);

    await this.db.role.delete({ where: { id: role.id } });
    await this.permissions.invalidateAll();
  }

  /** Danh mục quyền có trong database, kèm nhóm hiển thị. */
  async listPermissions() {
    return this.db.permission.findMany({
      orderBy: [{ category: "asc" }, { key: "asc" }],
      select: { key: true, name: true, category: true, description: true },
    });
  }
}

export const roleService = new RoleService();
