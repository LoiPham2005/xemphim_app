import { z } from "zod";

/**
 * Cờ bật/tắt một tiến trình phụ. Chỉ nhận `1` (bật) hoặc `0` (tắt).
 *
 * Nằm riêng một file vì BA bộ schema env phải hiểu giống hệt nhau:
 * `src/lib/env.ts` (app), `worker/env.ts`, `realtime/env.ts`. Chép ba bản là
 * chép cả ba cơ hội để chúng lệch nhau.
 *
 * ---
 * VÌ SAO KHÔNG NHẬN `true`/`false`
 *
 * Chính biến này được `docker-compose.yml` dùng làm số bản sao của service
 * tương ứng: `deploy: { replicas: ${QUEUE_ENABLED:-1} }`. Đặt `0` là container
 * không được dựng — và nếu nó đang chạy thì `docker compose up -d` gỡ nó đi.
 * Compose chỉ hiểu SỐ; đưa `true` vào là nó dừng ngay với
 * `strconv.Atoi: parsing "true": invalid syntax`.
 *
 * ---
 * VÌ SAO DÙNG CHUNG MỘT BIẾN CHO CẢ APP LẪN COMPOSE
 *
 * Tách làm hai (`QUEUE_ENABLED` cho app, `WORKER_REPLICAS` cho compose) thì
 * sớm muộn hai bên lệch nhau, và một trong hai chiều lệch diễn ra HOÀN TOÀN
 * TRONG IM LẶNG: app vẫn đẩy job vào Redis trong khi không có worker nào chạy.
 * Job nằm đó mãi, email không bao giờ được gửi, không một dòng log nào báo.
 * Một biến thì không có chỗ cho chiều lệch đó tồn tại.
 *
 * ---
 * `Boolean("0") === true` — bẫy kinh điển của biến môi trường, vì mọi giá trị
 * đều là chuỗi. Ở đây so khớp tường minh và từ chối giá trị lạ thay vì đoán.
 */
export function featureFlag(defaultValue: boolean) {
  return z.preprocess(
    (value) => {
      if (value === undefined || value === "") return defaultValue;
      if (value === "1") return true;
      if (value === "0") return false;
      // Trả nguyên giá trị lạ để Zod báo lỗi kèm TÊN BIẾN — quan trọng hơn hẳn
      // một thông báo chung chung, vì file .env thường có hàng chục dòng.
      return value;
    },
    z.boolean({
      error:
        "chỉ nhận 1 (bật) hoặc 0 (tắt) — docker-compose dùng chính biến này làm số replicas nên true/false không hợp lệ",
    }),
  );
}
