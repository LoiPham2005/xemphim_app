import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "coverage/**",
      "realtime/dist/**",
      "worker/dist/**",
      "next-env.d.ts",
      "*.tsbuildinfo",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Bật type-aware linting. Các rule quan trọng nhất
        // (no-floating-promises, no-misused-promises) chỉ chạy được khi
        // ESLint có thông tin kiểu.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Rules của Next.js + React Hooks — trước đây thiếu hoàn toàn.
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
    },
  },

  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // Promise bị quên await là nguồn bug số 1 trong Server Actions.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // Script chạy bằng Node (seed) được phép log thoải mái.
  {
    files: ["prisma/**/*.ts"],
    rules: { "no-console": "off" },
  },

  /*
   * RANH GIỚI TẦNG, ép bằng máy.
   *
   * Route handler và Server Action KHÔNG được chạm Prisma — mọi truy vấn đi
   * qua `src/services/*.ts`. Không có luật này thì ranh giới chỉ là kỷ luật,
   * và kỷ luật thì rò rỉ: mỗi lần "lần này query nhanh gọn thôi mà" là một
   * chỗ nghiệp vụ nằm ngoài chỗ nó phải nằm, không test được và không tái
   * dùng được cho worker hay REST API.
   *
   * Đây chính là thứ mà bộ khung monorepo mua được bằng cách tách package.
   * Ở đây mua bằng 10 dòng cấu hình.
   */
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "realtime/**/*.ts"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/prisma",
              message:
                "Route/Action không query database trực tiếp. Thêm method vào src/services/*.ts rồi gọi service.",
            },
            {
              name: "@prisma/client",
              importNames: ["PrismaClient"],
              message:
                "Chỉ src/services/* và src/lib/prisma.ts được dựng PrismaClient. Type Prisma thì import type là được.",
            },
          ],
        },
      ],
    },
  },

  // File test.
  {
    files: ["**/*.test.{ts,tsx}", "vitest.setup.ts", "test/**/*.ts"],
    rules: {
      // `vi.mocked(prisma.user.create)` là cách dùng đúng và bắt buộc của
      // vitest, nhưng rule này đọc nó thành method bị tách khỏi object.
      "@typescript-eslint/unbound-method": "off",

      // `expect.any(Date)`, `expect.objectContaining(...)` được vitest khai
      // kiểu trả về là `any` — đó là bản chất của matcher bất đối xứng, không
      // phải chỗ mất kiểu do viết ẩu. Rule này chỉ có ý nghĩa với code thật.
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },

  // File config và script .mjs/.cjs — chạy bằng Node, không nằm trong chương
  // trình TypeScript nên không lint theo kiểu được.
  {
    files: ["**/*.mjs", "**/*.js", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        // .cjs (vd ecosystem.config.cjs cho PM2) dùng CommonJS, không phải ESM.
        module: "writable",
        exports: "writable",
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    rules: { "no-console": "off" },
  },

  // Luôn để cuối: tắt mọi rule xung đột với Prettier.
  prettierConfig,
);
