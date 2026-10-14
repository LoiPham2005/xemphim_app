import { expect, test, type Page } from "@playwright/test";

/**
 * Ranh giới phân quyền, kiểm trên trình duyệt thật.
 *
 * Unit test đã khoá chặt phần "Server Action tự kiểm quyền". Phần E2E kiểm thứ
 * unit test không thấy: người dùng thật, đi từ trang thật, có bị chặn không —
 * và bị chặn theo đúng cách đã thiết kế (404, không phải 403).
 */

// Tài khoản mẫu do `pnpm db:seed` tạo — xem `prisma/seeds/seed-dev.ts`.
const DEV_PASSWORD = "matkhau123";

async function login(page: Page, identifier: string) {
  await page.goto("/login");
  await page.getByLabel("Email hoặc tên đăng nhập").fill(identifier);
  await page.getByLabel("Mật khẩu").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  // Chờ RỜI KHỎI /login — tức là đăng nhập xong và cookie phiên đã được đặt. Bản cũ chờ
  // `/\/users|\/login/`: URL lúc vừa bấm nút VẪN là /login nên khớp ngay, test chạy tiếp khi chưa
  // đăng nhập xong, `goto("/users")` bị đá về trang đăng nhập (200) — trông như lỗi phân quyền.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("Phân quyền", () => {
  test("USER thường vào /users nhận 404, KHÔNG phải 403", async ({ page }) => {
    await login(page, "user@dev.local");

    const response = await page.goto("/users");

    // 404 có chủ đích: 403 xác nhận cho người hỏi biết tài nguyên đó tồn tại.
    expect(response?.status()).toBe(404);
  });

  test("USER thường không thấy trang vai trò", async ({ page }) => {
    await login(page, "user@dev.local");

    const response = await page.goto("/roles");

    expect(response?.status()).toBe(404);
  });

  test("ADMIN mở được trang vai trò và thấy đủ ô tick quyền", async ({ page }) => {
    await login(page, "admin@dev.local");

    await page.goto("/roles");

    await expect(page.getByRole("heading", { name: /Vai trò/ })).toBeVisible();
    // Hai vai trò hệ thống luôn tồn tại.
    await expect(page.getByText("ADMIN", { exact: true })).toBeVisible();
    await expect(page.getByText("USER", { exact: true })).toBeVisible();
    // Bảng phân quyền phải dựng được ô tick từ danh mục quyền trong code.
    await expect(page.locator('input[name="permissions"]').first()).toBeVisible();
  });

  test("vai trò hệ thống không có nút xoá", async ({ page }) => {
    await login(page, "admin@dev.local");
    await page.goto("/roles");

    // Xoá mất ADMIN là khoá cửa cả hệ thống. Nút không được phép tồn tại — và
    // service vẫn chặn lần nữa nếu ai đó gọi thẳng action.
    const adminCard = page.locator("section.card").filter({ hasText: "Quản trị viên" });
    await expect(adminCard.getByRole("button", { name: "Xoá" })).toHaveCount(0);
  });
});

test.describe("REST API", () => {
  test("gọi /api/v1/users không token trả 401 JSON, không phải redirect HTML", async ({
    request,
  }) => {
    const response = await request.get("/api/v1/users");

    // Proxy cố tình không chạy trên /api. Nếu nó chạy, token hết hạn sẽ thành
    // 307 dẫn tới trang login — lỗi cực khó nhìn ra từ phía app mobile vì nó
    // trông y hệt một request thành công.
    expect(response.status()).toBe(401);
    expect(response.headers()["content-type"]).toContain("application/json");

    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  test("health check trả trạng thái database", async ({ request }) => {
    const response = await request.get("/api/health");

    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { status: string; database: string };
    expect(body.status).toBe("ok");
    expect(body.database).toBe("up");
  });
});
