import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { permissionService } from "@/services/permission.service";

/**
 * Khung chung của khu quản trị.
 *
 * ---
 * ⚠️ LAYOUT KHÔNG PHẢI RANH GIỚI BẢO MẬT
 *
 * Đây là điều quan trọng nhất phải nhớ khi sửa file này. `requireUser()` bên
 * dưới CHỈ chặn được người chưa đăng nhập mở TRANG. Nó không chặn được:
 *
 *   - Server Action: mỗi action là một HTTP endpoint công khai, request gửi
 *     thẳng tới action id không hề đi qua layout nào.
 *   - Route handler trong `src/app/api/**`: proxy còn cố tình không chạy ở đó.
 *
 * Vì vậy hai lớp sau vẫn giữ nguyên và KHÔNG được lược bớt:
 *
 *   1. Mỗi trang tự gọi `requirePermission(...)` với đúng quyền của nó —
 *      layout không thể biết `/users` cần `user:read` còn `/roles` cần
 *      `role:read`.
 *   2. Mỗi Server Action tự kiểm quyền. Đây mới là lớp chặn thật.
 *
 * Layout chỉ làm hai việc: bớt lặp phần khung, và lo phần nhìn.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Chưa đăng nhập thì đá về /login kèm ?next= — làm ở đây để ba trang con
  // không phải lặp lại. Kiểm tra QUYỀN vẫn nằm ở từng trang.
  const user = await requireUser("/users");

  // `can()` nhận ID NGƯỜI DÙNG. Bản cũ truyền `user.roles.join(", ")` ("ADMIN, USER") — không ai có id
  // đó nên luôn ra "không có quyền", và cả khu quản trị trả 404 với mọi người kể cả SUPER_ADMIN.
  const [canSeeMovies, canSeeUsers, canSeeRoles, canSeeFiles] = await Promise.all([
    permissionService.can(user.id, "movie:manage"),
    permissionService.can(user.id, "user:read"),
    permissionService.can(user.id, "role:read"),
    permissionService.can(user.id, "file:manage"),
  ]);

  if (!canSeeMovies && !canSeeUsers && !canSeeRoles && !canSeeFiles) {
    notFound();
  }

  const items = [
    { href: "/movies", label: "Phim", visible: canSeeMovies },
    { href: "/users", label: "Người dùng", visible: canSeeUsers },
    { href: "/roles", label: "Vai trò & phân quyền", visible: canSeeRoles },
    { href: "/files", label: "Tệp tin", visible: canSeeFiles },
  ] as const;

  const visibleItems = items.filter((item) => item.visible);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 lg:flex-row lg:px-8">
      {/*
        Chỉ dựng sidebar khi có từ 2 mục trở lên. Một menu chỉ có đúng một dòng
        không giúp điều hướng gì cả, nó chỉ lấy mất chỗ của nội dung.
      */}
      {visibleItems.length > 1 && (
        <aside className="lg:w-56 lg:shrink-0">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-muted">
            Quản trị
          </p>

          <nav className="flex gap-1 lg:flex-col">
            {visibleItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-token-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-elevated hover:text-content"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
      )}

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
