import { defineConfig } from "vitest/config";
import path from "node:path";

const rootDir = import.meta.dirname;

const alias = {
  "@": path.resolve(rootDir, "./src"),
  // `server-only` ném lỗi khi được import ngoài React Server Component. Trong
  // test thì đó là dương tính giả, nên thay bằng module rỗng.
  "server-only": path.resolve(rootDir, "./test/stubs/server-only.ts"),
};

/**
 * Biến môi trường tối thiểu để `src/lib/env.ts` vượt qua validation.
 *
 * Nhiều service đọc `env` ngay lúc import module, nên thiếu một biến ở đây là
 * cả file test đổ vỡ trước khi chạy tới `it()` đầu tiên — chứ không phải một
 * test đỏ.
 *
 * `ENCRYPTION_KEY` và `PHONE_VERIFICATION_ENABLED` bật hai nhánh chỉ tồn tại
 * khi đã cấu hình: mã hoá bí mật TOTP, và xác thực số điện thoại (mặc định TẮT
 * vì SMS tốn tiền — xem `PHONE_VERIFICATION_ENABLED` trong `.env.example`).
 */
const testEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  SESSION_SECRET: "test-session-secret-at-least-32-characters-long",
  ENCRYPTION_KEY: "test-encryption-key-at-least-16-chars",
  APP_URL: "http://localhost:3000",
  PHONE_VERIFICATION_ENABLED: "1",
} as const;

export default defineConfig({
  test: {
    // Hai môi trường tách biệt: logic server chạy trên Node (nhanh), component
    // React chạy trên jsdom.
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          env: testEnv,
          include: ["src/**/*.test.ts", "realtime/**/*.test.ts"],
        },
      },
      {
        // Không cần @vitejs/plugin-react: nó chỉ thêm Fast Refresh (vô nghĩa
        // trong test), còn JSX đã được esbuild xử lý theo `jsx: react-jsx`
        // trong tsconfig.
        resolve: { alias },
        test: {
          name: "dom",
          environment: "jsdom",
          env: testEnv,
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/app/**/layout.tsx",
        "src/app/**/loading.tsx",
        "src/**/*.d.ts",
      ],

      /*
       * Ngưỡng đặt theo TỪNG VÙNG, không đặt một con số cho cả dự án.
       *
       * Một ngưỡng tổng phải hạ xuống thấp cho vừa các trang giao diện (vốn
       * được E2E lo, không phải unit test lo), và khi đã hạ xuống thấp thì nó
       * không còn chặn được gì ở tầng nghiệp vụ — đúng nơi cần chặn nhất.
       *
       * Các con số dưới đây được đặt ngay dưới mức thực tế hiện tại. Ý nghĩa
       * của chúng là "không được tụt", không phải "phải đạt": tăng dần khi
       * viết thêm test, và ĐỪNG hạ xuống để CI xanh — hạ ngưỡng là bỏ đúng
       * cái phanh vừa lắp.
       */
      thresholds: {
        "src/services/**": { statements: 70, branches: 55, functions: 70, lines: 70 },
        "src/lib/api/**": { statements: 80, branches: 85, functions: 80, lines: 80 },
      },
    },
  },
});
