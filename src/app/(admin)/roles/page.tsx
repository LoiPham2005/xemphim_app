import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS, PERMISSION_METADATA, type Permission } from "@/lib/permissions";
import { permissionService } from "@/services/permission.service";
import { roleService } from "@/services/role.service";
import { RoleCreateForm } from "./role-create-form";
import { RoleDeleteButton } from "./role-delete-button";
import { RolePermissionForm } from "./role-permission-form";

export const metadata: Metadata = { title: "Vai trò & phân quyền" };
export const dynamic = "force-dynamic";

/**
 * Màn hình phân quyền — thứ biến lời hứa "sửa được lúc chạy" thành sự thật.
 *
 * Trước trang này, ba bảng `roles`/`permissions`/`role_permissions` không có
 * đường ghi nào từ ứng dụng: muốn đổi phân quyền phải gõ SQL tay.
 *
 * Danh mục quyền hiển thị ở đây đến từ CODE (`src/lib/permissions.ts`), không
 * phải từ database. Cho phép tạo quyền mới từ giao diện sẽ sinh ra những ô
 * tick không ràng buộc điều gì — người quản trị tưởng đã cấm được, mà không
 * dòng mã nào kiểm tra tới.
 */
export default async function RolesPage() {
  const currentUser = await requirePermission("role:read", "/roles");

  const [roles, canUpdate, canCreate, canDelete] = await Promise.all([
    roleService.list(),
    permissionService.can(currentUser.id, "role:update"),
    permissionService.can(currentUser.id, "role:create"),
    permissionService.can(currentUser.id, "role:delete"),
  ]);

  const options = PERMISSIONS.map((key) => ({
    key,
    description: PERMISSION_METADATA[key].description,
  }));

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <Link href="/users" style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
          ← Quản lý người dùng
        </Link>
        <h1 className="page-title">Vai trò &amp; phân quyền</h1>
        <p className="page-subtitle">
          Thay đổi có hiệu lực ngay. Riêng người đang đăng nhập giữ vai trò cũ trong token cho tới
          khi phiên hết hạn.
        </p>
      </div>

      {canCreate && (
        <section className="card">
          <h2 style={{ fontSize: "1.2rem", marginBottom: 16 }}>Tạo vai trò mới</h2>
          <RoleCreateForm />
        </section>
      )}

      {roles.map((role) => (
        <section key={role.key} className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 16,
              flexWrap: "wrap",
              marginBottom: 16,
            }}
          >
            <div>
              <h2 style={{ fontSize: "1.2rem", display: "flex", alignItems: "center", gap: 8 }}>
                {role.name} <code style={{ fontSize: "0.85rem" }}>{role.key}</code>
                {role.isSystem && <span className="badge badge-primary">Hệ thống</span>}
              </h2>
              {role.description && (
                <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", marginTop: 4 }}>
                  {role.description}
                </p>
              )}
              <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginTop: 4 }}>
                {role.userCount} người dùng · {role.permissions.length}/{PERMISSIONS.length} quyền
              </p>
            </div>

            {/*
              Vai trò hệ thống không hiện nút xoá. Không phải để "làm gọn giao
              diện" — xoá mất ADMIN là khoá cửa cả hệ thống và không còn ai đủ
              quyền tạo lại. Service vẫn chặn lần nữa dù nút có bị gọi thẳng.
            */}
            {canDelete && !role.isSystem && (
              <RoleDeleteButton roleKey={role.key} userCount={role.userCount} />
            )}
          </div>

          <RolePermissionForm
            roleKey={role.key}
            granted={role.permissions as Permission[]}
            options={options}
            disabled={!canUpdate}
          />
        </section>
      ))}
    </>
  );
}
