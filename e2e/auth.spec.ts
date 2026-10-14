import { expect, test, type Page } from "@playwright/test";

/**
 * Ô thông báo CỦA APP. `getByRole("alert")` trần khớp thêm `#__next-route-announcer__` — vùng đọc
 * thông báo chuyển trang mà Next.js tự chèn vào MỌI trang, cũng mang `role="alert"`.
 */
function appAlert(page: Page) {
  return page.getByRole("alert").and(page.locator(".alert"));
}

/**
 * Luồng đăng nhập/đăng ký chạy trên trình duyệt thật.
 *
 * Đây là bộ test đáng lẽ đã bắt được lỗi "form gửi `email` trong khi schema
 * đòi `identifier`" — lỗi làm đăng nhập web hỏng hoàn toàn mà cả typecheck,
 * unit test lẫn build đều báo xanh.
 *
 * Điều kiện chạy: database đã `pnpm db:seed`. Tài khoản dùng ở đây là
 * tài khoản mẫu của bộ seed đó.
 */

// Tài khoản mẫu do `pnpm db:seed` tạo — xem `prisma/seeds/seed-dev.ts`.
const DEV_PASSWORD = "matkhau123";

test.describe("Đăng nhập", () => {
  test("đăng nhập bằng EMAIL rồi vào được trang cần quyền", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Email hoặc tên đăng nhập").fill("admin@dev.local");
    await page.getByLabel("Mật khẩu").fill(DEV_PASSWORD);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();

    // Đăng nhập thành công thì action redirect sang /users.
    await expect(page).toHaveURL(/\/users/);
    await expect(page.getByRole("heading", { name: "Quản lý người dùng" })).toBeVisible();
  });

  test("đăng nhập bằng TÊN ĐĂNG NHẬP — cùng một ô nhập", async ({ page }) => {
    // Ô `identifier` nhận cả hai loại; có ký tự `@` thì tra theo email, không
    // thì tra theo username. Không test nhánh này thì việc gộp hai ô làm một
    // chỉ được kiểm ở tầng service, nơi nó luôn đúng.
    await page.goto("/login");

    await page.getByLabel("Email hoặc tên đăng nhập").fill("devadmin");
    await page.getByLabel("Mật khẩu").fill(DEV_PASSWORD);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();

    await expect(page).toHaveURL(/\/users/);
  });

  test("sai mật khẩu thì hiện lỗi và Ở LẠI trang đăng nhập", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Email hoặc tên đăng nhập").fill("admin@dev.local");
    await page.getByLabel("Mật khẩu").fill("sai-mat-khau-hoan-toan");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();

    // Điểm mấu chốt: phải có THÔNG BÁO nhìn thấy được. Lỗi cũ khiến form im
    // lặng không phản ứng gì — về mặt kỹ thuật cũng là "ở lại trang login",
    // nên chỉ kiểm URL thôi là không đủ.
    await expect(appAlert(page)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("chưa đăng nhập mà vào /users thì bị đá về /login kèm ?next=", async ({ page }) => {
    await page.goto("/users");

    await expect(page).toHaveURL(/\/login\?next=%2Fusers/);
  });
});

test.describe("Đăng ký", () => {
  test("tạo tài khoản mới và giữ được họ tên đã nhập", async ({ page }) => {
    // Email phải khác nhau giữa các lần chạy — database không được reset giữa
    // các test, và đăng ký trùng email là lỗi hợp lệ.
    const email = `e2e-${Date.now()}@example.com`;
    const fullName = "Người Dùng E2E";

    await page.goto("/register");

    await page.getByLabel("Tên hiển thị").fill(fullName);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mật khẩu").fill("matkhau-e2e-123");
    await page.getByRole("button", { name: "Đăng ký" }).click();

    // Đăng ký xong là có phiên luôn, nên header hiện thông tin người dùng.
    // Đây cũng chính là chỗ bắt lỗi "form gửi `name` nhưng schema đòi
    // `fullName`": Zod strip im lặng khoá lạ nên đăng ký vẫn thành công, chỉ
    // có họ tên là biến mất.
    await expect(page.getByText(fullName)).toBeVisible();
  });
});

test.describe("Quên mật khẩu", () => {
  test("luôn trả cùng một thông điệp, kể cả với email không tồn tại", async ({ page }) => {
    await page.goto("/forgot-password");

    await page.getByLabel("Email").fill("khong-ai-dung-dia-chi-nay@example.com");
    await page.getByRole("button", { name: "Gửi hướng dẫn đặt lại" }).click();

    // Không được tiết lộ email có tài khoản hay không — đó là cách dò danh
    // sách người dùng rẻ nhất.
    await expect(page.getByRole("status")).toContainText("Nếu địa chỉ này có tài khoản");
  });

  test("mở /reset-password không kèm token thì báo link hỏng, không dựng form", async ({
    page,
  }) => {
    await page.goto("/reset-password");

    await expect(appAlert(page)).toContainText("không hợp lệ");
    await expect(page.getByLabel("Mật khẩu mới")).toHaveCount(0);
  });
});
