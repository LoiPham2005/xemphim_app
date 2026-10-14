/**
 * Cấu hình PM2 cho Next.js standalone + máy chủ realtime.
 *
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 reload ecosystem.config.cjs --env production   # nạp lại không rớt kết nối
 *   pm2 logs
 *
 * ---
 * ⚠️ CLUSTER MODE VÀ REDIS — ĐỌC TRƯỚC KHI ĐỔI SỐ INSTANCE
 *
 * Ứng dụng này giữ HAI thứ trong RAM của từng tiến trình:
 *
 *   1. Bộ đếm rate limit (`src/lib/rate-limit.ts`) khi chưa set `REDIS_URL`.
 *   2. Cache bản đồ vai trò → quyền (`permission.service.ts`), TTL 60 giây.
 *
 * Chạy N instance mà không có Redis thì ngưỡng đăng nhập bị NHÂN N: cấu hình 5
 * lần/5 phút, chạy 8 nhân, thực tế thành 40. Không có lỗi nào, không có dòng
 * log nào — chỉ là chốt chặn brute-force yếu đi 8 lần.
 *
 * Vì vậy `instances` mặc định là 1, KHÔNG phải "max". Muốn nhiều nhân thì đặt
 * `REDIS_URL` trước, rồi mới `PM2_INSTANCES=max`. Đoạn kiểm tra bên dưới sẽ
 * chặn lại nếu làm ngược thứ tự.
 */

/**
 * Đọc cờ bật/tắt tiến trình phụ. Cùng biến, cùng quy ước `1`/`0` với
 * `src/lib/feature-flag.ts` và `docker-compose.yml`.
 *
 * ⚠️ File cấu hình này được Node đánh giá TRƯỚC khi PM2 nạp `--env-file`, nên
 * nó chỉ thấy biến của SHELL, không thấy `.env`. Muốn tắt thì nạp file env vào
 * shell trước:
 *
 *   set -a && . ./.env && set +a && pnpm pm2:start
 *
 * Hoặc đơn giản hơn: `QUEUE_ENABLED=0 pnpm pm2:start`.
 *
 * (Đoạn kiểm tra PM2_INSTANCES bên dưới đã đọc `process.env.REDIS_URL` theo
 * đúng cách này từ trước — không phải quy ước mới.)
 */
function isEnabled(name) {
  const value = process.env[name];

  if (value === undefined || value === "" || value === "1") return true;
  if (value === "0") return false;

  throw new Error(
    `${name} chỉ nhận 1 (bật) hoặc 0 (tắt), nhận được "${value}". ` +
      `docker-compose dùng chính biến này làm số replicas nên true/false không hợp lệ.`,
  );
}

const realtimeEnabled = isEnabled("REALTIME_ENABLED");
const queueEnabled = isEnabled("QUEUE_ENABLED");

const instances = process.env.PM2_INSTANCES ?? "1";
const wantsCluster = instances === "max" || Number(instances) > 1;
const hasRedis = Boolean(process.env.REDIS_URL);

if (wantsCluster && !hasRedis) {
  throw new Error(
    [
      "",
      "PM2_INSTANCES yêu cầu chạy nhiều tiến trình nhưng REDIS_URL chưa được đặt.",
      "",
      "Mỗi tiến trình sẽ đếm rate limit riêng, nên ngưỡng chống brute-force bị",
      "nhân lên theo số instance — im lặng, không có cảnh báo nào lúc chạy.",
      "",
      "Cách xử lý, chọn một:",
      "  • Đặt REDIS_URL trong file env rồi chạy lại (khuyến nghị)",
      "  • Hoặc bỏ PM2_INSTANCES để chạy 1 tiến trình",
      "",
    ].join("\n"),
  );
}

/**
 * Biến chung cho cả hai tiến trình.
 *
 * PM2 tự kế thừa biến môi trường của shell, nhưng khai báo lại ở đây để
 * `pm2 reload` sau khi sửa file env vẫn lấy đúng giá trị mới.
 */
const shared = {
  cwd: "./",
  autorestart: true,
  watch: false,
  // Node đọc file env trực tiếp — không cần thư viện dotenv trên production.
  node_args: "--env-file-if-exists=.env",
  // Ghi log kèm mốc thời gian; thiếu nó thì `pm2 logs` chỉ là một khối chữ
  // không biết dòng nào xảy ra lúc nào.
  time: true,
};

/*
 * Lọc theo cờ thay vì để tiến trình tự thoát khi khởi động.
 *
 * PM2 `autorestart` bật lại tiến trình kể cả khi nó thoát với mã 0, nên một
 * worker "tự tắt vì QUEUE_ENABLED=0" sẽ quay vòng mãi trong danh sách
 * `pm2 list`. Không đưa nó vào ngay từ đầu mới là cách tắt đúng ở đây.
 */
module.exports = {
  apps: [
    {
      ...shared,
      name: "xemphim",
      script: ".next/standalone/server.js",
      instances,
      // `cluster` cho phép `pm2 reload` xoay vòng từng tiến trình nên không rớt
      // request. Với instances=1 thì nó vẫn hoạt động, chỉ là không tận dụng
      // được đa nhân.
      exec_mode: "cluster",
      max_memory_restart: "1G",
      env: { NODE_ENV: "development", PORT: 3000, HOSTNAME: "127.0.0.1" },
      // Chỉ nghe loopback: reverse proxy (Caddy/nginx) là cửa duy nhất ra
      // Internet. Bind 0.0.0.0 là để lộ cổng 3000, đi vòng qua cả TLS lẫn
      // rate limit của proxy.
      env_production: { NODE_ENV: "production", PORT: 3000, HOSTNAME: "127.0.0.1" },
    },
    realtimeEnabled && {
      ...shared,
      name: "xemphim-realtime",
      script: "realtime/dist/server.cjs",
      // LUÔN 1 instance, kể cả khi web chạy cluster: Socket.IO cần adapter
      // Redis mới phát tin được giữa các tiến trình. Nhiều instance mà thiếu
      // adapter thì client nối vào tiến trình A không nhận được tin từ B —
      // im lặng, không lỗi.
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "500M",
      env: { NODE_ENV: "development", REALTIME_PORT: 3002 },
      env_production: { NODE_ENV: "production", REALTIME_PORT: 3002 },
    },
    queueEnabled && {
      ...shared,
      name: "xemphim-worker",
      script: "worker/dist/worker.cjs",
      // Chạy nhiều worker LÀ an toàn: BullMQ khoá job qua Redis nên mỗi job
      // chỉ được giao cho đúng một worker. Nhưng mặc định vẫn để 1 — nâng lên
      // khi hàng đợi thật sự ùn, đừng nâng "cho chắc".
      instances: Number(process.env.PM2_WORKER_INSTANCES ?? 1),
      exec_mode: "fork",
      max_memory_restart: "700M",
      // Đợi worker chạy nốt job đang dở trước khi giết. Mặc định PM2 chỉ cho
      // 1.6 giây — quá ngắn cho phần lớn job thật.
      kill_timeout: 60_000,
      env: { NODE_ENV: "development" },
      env_production: { NODE_ENV: "production" },
    },
  ].filter(Boolean),
};
