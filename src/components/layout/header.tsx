import Link from "next/link";
import { LogOut, Search } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { MOVIE_TYPES, MOVIE_TYPE_LABELS } from "@/schemas/movie.schema";
import { logoutAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { permissionService } from "@/services/permission.service";

/**
 * Thanh điều hướng: logo, mục quản trị (nếu có quyền), ô tìm phim (gửi `?q=` về trang chủ), avatar.
 */
/** Các trang trong khu quản trị. Union để `typedRoutes` bắt lỗi đường dẫn sai. */
type AdminRoute = "/movies" | "/users" | "/roles";

export async function Header() {
  const user = await getCurrentUser();

  // Chỉ hiện mục quản trị cho người thật sự vào được. Link dẫn tới trang 404
  // không phải "bảo mật kém" (trang vẫn tự kiểm quyền), nhưng là giao diện tệ:
  // người dùng bấm vào thứ trông như dùng được rồi nhận trang không tìm thấy.
  // `can()` nhận ID NGƯỜI DÙNG (bản gốc truyền `user.roles.join()` nên mục quản trị không bao giờ hiện).
  const [canManageMovies, canSeeUsers, canSeeRoles] = user
    ? await Promise.all([
        permissionService.can(user.id, "movie:manage"),
        permissionService.can(user.id, "user:read"),
        permissionService.can(user.id, "role:read"),
      ])
    : [false, false, false];

  const adminEntry: AdminRoute | null = canManageMovies
    ? "/movies"
    : canSeeUsers
      ? "/users"
      : canSeeRoles
        ? "/roles"
        : null;

  const displayName = user ? (user.fullName ?? user.email ?? user.username ?? "?") : "";

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-canvas/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Logo />

          <nav className="hidden items-center gap-1 md:flex">
            <NavLink href="/">Trang chủ</NavLink>
            {user &&
              MOVIE_TYPES.map((type) => (
                <NavLink key={type} href={{ pathname: "/", query: { type } }}>
                  {MOVIE_TYPE_LABELS[type]}
                </NavLink>
              ))}

            {/*
              MỘT lối vào khu quản trị, trỏ tới trang ĐẦU TIÊN người này thật sự vào được — sidebar
              trong `(admin)/layout.tsx` lo phần còn lại.
            */}
            {adminEntry && <NavLink href={adminEntry}>Quản trị</NavLink>}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {user && (
            <form action="/" method="get" role="search" className="relative hidden sm:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                name="q"
                type="search"
                placeholder="Tìm phim..."
                aria-label="Tìm phim"
                className="h-9 w-44 rounded-full border border-line bg-surface/80 pl-9 pr-3 text-sm text-content placeholder:text-muted transition-all focus:w-64 focus:border-brand/60 focus:outline-none"
              />
            </form>
          )}

          {user ? (
            <>
              {/* Tên người dùng dẫn thẳng tới màn quản lý thiết bị — đó là
                  chỗ người ta tìm khi nghi ngờ tài khoản bị đăng nhập lạ. */}
              <Link
                href="/sessions"
                title={displayName}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand to-accent text-sm font-bold uppercase text-white ring-2 ring-transparent transition hover:ring-brand/50"
              >
                {displayName.charAt(0)}
              </Link>
              {/* Server Action xoá cookie phiên rồi về /login. KHÔNG trỏ form vào
                  `/api/v1/auth/logout` — endpoint đó cho mobile, đòi body JSON. */}
              <form action={logoutAction}>
                <Button size="icon-sm" variant="ghost" type="submit" title="Đăng xuất">
                  <LogOut className="h-4 w-4" />
                  <span className="sr-only">Đăng xuất</span>
                </Button>
              </form>
            </>
          ) : (
            <>
              <Button asChild size="sm" variant="ghost">
                <Link href="/login">Đăng nhập</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/register">Đăng ký</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  children,
}: {
  href: "/" | AdminRoute | { pathname: "/"; query: Record<string, string> };
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-full px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-white/5 hover:text-content"
    >
      {children}
    </Link>
  );
}
