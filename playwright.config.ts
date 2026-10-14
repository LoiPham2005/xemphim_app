import { defineConfig, devices } from "@playwright/test";

/**
 * Cấu hình E2E.
 *
 * ---
 * VÌ SAO DỰ ÁN NÀY CẦN E2E
 *
 * Đã có ~170 unit test phủ kín tầng service, và chúng vẫn để lọt một lỗi làm
 * ĐĂNG NHẬP WEB HỎNG HOÀN TOÀN: form gửi trường `email` trong khi schema đã
 * đổi sang `identifier`. Không lớp nào bắt được —
 *
 *   - TypeScript không bắt, vì `safeParse()` nhận `unknown`;
 *   - unit test không bắt, vì chúng gọi thẳng service, không đi qua form;
 *   - build không bắt, vì cả hai phía đều hợp lệ khi đứng riêng.
 *
 * Chỉ có một thứ bắt được: mở trình duyệt thật và bấm nút. Đó chính là công
 * việc của thư mục `e2e/`.
 *
 * Vì vậy bộ test ở đây cố tình HẸP — chỉ những luồng mà "hỏng là dịch vụ chết":
 * đăng nhập, đăng ký, chặn quyền. Không dùng E2E để kiểm nghiệp vụ chi tiết;
 * phần đó thuộc về unit test, vốn nhanh hơn hàng trăm lần.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",

  // Mỗi test tự đăng nhập bằng tài khoản riêng, không dùng chung trạng thái,
  // nên chạy song song được. Riêng trên CI thì tắt: một runner chia sẻ CPU với
  // Postgres và server Next, chạy song song chỉ làm test chập chờn.
  fullyParallel: !process.env.CI,
  workers: process.env.CI ? 1 : undefined,

  // Cấm `test.only` lọt lên nhánh chính — nó làm CI xanh trong khi hầu hết
  // test không hề chạy.
  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL,
    // Chỉ giữ dấu vết của lần chạy hỏng: trace đầy đủ rất nặng, mà lần chạy
    // xanh thì không ai mở ra xem.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  /*
   * Chạy bản BUILD PRODUCTION, không phải `next dev`.
   *
   * Hai môi trường khác nhau ở đúng những chỗ dễ hỏng: dev có React Refresh và
   * CSP nới lỏng (`unsafe-eval`), production thì không. Test trên dev sẽ bỏ
   * qua đúng loại lỗi mà E2E sinh ra để bắt.
   */
  webServer: {
    command: "pnpm build && pnpm start",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      NODE_ENV: "production",
    },
  },
});
