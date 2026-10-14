import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { userService } from "@/services/user.service";
import { UserForm } from "./user-form";
import { UserDeleteButton } from "./user-delete-button";
import { UserStatusButton } from "./user-status-button";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Quản lý người dùng" };
export const dynamic = "force-dynamic";

/**
 * Số dòng mỗi trang.
 *
 * 20 chứ không phải 50: danh sách này có nút Khoá và Xoá ở mỗi dòng, và trang
 * càng dài thì càng dễ bấm nhầm dòng bên cạnh.
 */
const PER_PAGE = 20;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  // Lớp bảo vệ ở tầng trang. Server Action còn tự kiểm tra lại một lần nữa —
  // xem `actions.ts` để biết vì sao không thể chỉ dựa vào chỗ này.
  const currentUser = await requirePermission("user:read", "/users");

  const { page } = await searchParams;

  /*
   * `userService.list` trả cả `items` lẫn `meta` (tổng số, số trang, còn trang
   * sau không) trong MỘT lần gọi — trước đây phải gọi thêm `count()` riêng, và
   * hai truy vấn đó có thể thấy hai trạng thái khác nhau của bảng.
   */
  const currentPage = Number(page) || 1;
  const { items: users, meta } = await userService.list({
    page: currentPage,
    limit: PER_PAGE,
    includeDeleted: false,
  });

  return (
    <>
      <div
        style={{
          marginBottom: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <Link href="/" style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
            ← Quay lại trang chủ
          </Link>
          <h1 className="page-title">Quản lý người dùng</h1>
        </div>
        <span className="badge badge-primary">Tổng: {meta.total}</span>
      </div>

      <section className="card">
        <h2 style={{ fontSize: "1.2rem", marginBottom: 16 }}>Thêm người dùng mới</h2>
        <UserForm />
      </section>

      <section className="card">
        <h2 style={{ fontSize: "1.2rem", marginBottom: 16 }}>Danh sách người dùng</h2>

        {users.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)" }}>
            <p style={{ fontSize: "1.1rem" }}>Chưa có người dùng nào trong cơ sở dữ liệu.</p>
          </div>
        ) : (
          <ul className="user-list">
            {users.map((user: (typeof users)[number]) => (
              <li key={user.id} className="user-item">
                <div className="user-info">
                  <span className="user-email">{user.email ?? user.username ?? ""}</span>
                  <div className="user-meta">
                    {user.fullName && <span>👤 {user.fullName}</span>}
                    {user.username && <span>@{user.username}</span>}
                    <span className="badge badge-success">{user.roles.join(", ")}</span>
                    {user.status === "BANNED" && (
                      <span className="badge badge-danger">Đã khoá</span>
                    )}
                    {user.status === "ACTIVE" &&
                      user.lockedUntil &&
                      user.lockedUntil > new Date() && (
                        <span className="badge badge-warning">Khoá tạm (sai mật khẩu)</span>
                      )}
                    <span>📅 {user.createdAt.toLocaleDateString("vi-VN")}</span>
                  </div>
                </div>
                {user.id === currentUser.id ? (
                  <span className="badge badge-primary">Bạn</span>
                ) : (
                  <div style={{ display: "flex", gap: 8 }}>
                    <UserStatusButton
                      id={user.id}
                      email={user.email ?? user.username ?? ""}
                      status={user.status}
                      lockedUntil={user.lockedUntil?.toISOString() ?? null}
                    />
                    <UserDeleteButton id={user.id} email={user.email ?? user.username ?? ""} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/*
          Phân trang theo SỐ TRANG, không phải cursor.

          Cursor cuộn vô hạn tốt hơn, nhưng màn quản trị cần nhảy tới "trang 7"
          và cần biết TỔNG số bản ghi — cursor không cho cả hai. Mỗi trang là
          một URL riêng nên nút Back của trình duyệt vẫn làm đúng việc của nó.
        */}
        {(meta.page > 1 || meta.hasNext) && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              marginTop: 20,
              paddingTop: 16,
              borderTop: "1px solid var(--border-color)",
            }}
          >
            <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
              Trang {meta.page}/{meta.totalPages} · {meta.total} người dùng
            </span>

            <div style={{ display: "flex", gap: 8 }}>
              {meta.page > 1 && (
                <Button asChild variant="outline" size="sm">
                  <Link href={{ pathname: "/users", query: { page: meta.page - 1 } }}>
                    ← Trang trước
                  </Link>
                </Button>
              )}
              {meta.hasNext && (
                <Button asChild variant="outline" size="sm">
                  <Link href={{ pathname: "/users", query: { page: meta.page + 1 } }}>
                    Trang sau →
                  </Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
