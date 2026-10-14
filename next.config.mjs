/**
 * Header bảo mật tĩnh, áp cho mọi response.
 *
 * Content-Security-Policy KHÔNG nằm ở đây: nó cần nonce sinh riêng theo từng
 * request nên được set trong `src/middleware.ts`.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const isVercel = process.env.VERCEL === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Chỉ bật standalone khi không deploy lên Vercel (dành cho Docker/VPS)
  ...(isVercel ? {} : { output: "standalone" }),

  // Không quảng cáo framework đang chạy phía sau.
  poweredByHeader: false,

  // <Link href="..."> được typecheck theo route thật sự tồn tại.
  typedRoutes: true,

  ...(isVercel
    ? {}
    : {
        outputFileTracingIncludes: {
          "**/*": ["./node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**"],
        },
      }),

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
