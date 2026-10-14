import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { userService } from "@/services/user.service";
import type { Permission } from "./permissions";
import { permissionService } from "@/services/permission.service";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
  signSession,
  verifySession,
  type SessionPayload,
} from "./session";

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/**
 * Đọc session từ cookie. Rẻ — chỉ verify chữ ký, không chạm database.
 * `cache()` đảm bảo nhiều component trong cùng một request chỉ verify một lần.
 */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const cookieStore = await cookies();
  return verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
});

/**
 * Lấy user từ database theo session.
 *
 * Vì sao không dùng thẳng dữ liệu trong token: token sống nhiều ngày. Trong
 * khoảng đó user có thể bị xoá hoặc bị hạ quyền, mà token cũ vẫn hợp lệ về chữ
 * ký. Mọi quyết định phân quyền phải dựa trên dữ liệu đọc từ database.
 */
export const getCurrentUser = cache(async () => {
  const session = await getSession();
  if (!session) return null;

  // Đi qua `userService` thay vì tự viết `select`: cột `password` và
  // `twoFactorSecret` không bao giờ được đọc lên ở đây, và luật đó chỉ tồn tại
  // ở đúng một chỗ (`USER_SELECT`).
  return userService.findById(session.sub);
});

/** Dùng trong page/layout. Chưa đăng nhập thì đá về /login. */
export async function requireUser(returnTo?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login";
    redirect(target);
  }
  return user;
}

/**
 * Dùng trong page/layout cần quyền ADMIN.
 *
 * Người đã đăng nhập nhưng không đủ quyền nhận 404 chứ không phải 403: 403 xác
 * nhận cho họ biết tài nguyên đó có tồn tại.
 *
 * Kiểm tra theo VAI TRÒ. Khi câu hỏi là "được làm hành động gì" chứ không phải
 * "có phải quản trị viên không", dùng `requirePermission` — nó không phải sửa
 * lại khi sau này thêm vai trò mới.
 */
export async function requireAdmin(returnTo?: string): Promise<CurrentUser> {
  const user = await requireUser(returnTo);
  if (!user.roles.includes("ADMIN")) notFound();
  return user;
}

/**
 * Dùng trong page/layout cần một quyền hạn cụ thể.
 *
 * Nên dùng thay cho `requireAdmin` ở phần lớn trường hợp: khi thêm vai trò mới
 * (MANAGER, STAFF…), chỉ phải sửa bảng trong `permissions.ts`, không phải đi
 * lùng từng chỗ đang so sánh `role === "ADMIN"`.
 *
 * Cũng trả 404 như `requireAdmin`, vì cùng một lý do.
 */
export async function requirePermission(
  permission: Permission,
  returnTo?: string,
): Promise<CurrentUser> {
  const user = await requireUser(returnTo);
  if (!(await permissionService.can(user.id, permission))) notFound();
  return user;
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await signSession(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    ...sessionCookieOptions,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", { ...sessionCookieOptions, maxAge: 0 });
}
