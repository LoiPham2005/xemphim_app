/**
 * Màn "Đang tải" cho khu quản trị.
 *
 * Cố ý nằm ở `(admin)/` chứ KHÔNG ở gốc `app/`: có `loading.tsx` là Next.js phải chốt `200 OK` để bắt
 * đầu stream (node_modules/next/dist/docs/01-app/02-guides/streaming.md, mục "Status codes"), nên mọi
 * `notFound()` bên dưới nó chỉ đổi được giao diện, KHÔNG đổi được mã HTTP. Đặt ở gốc thì kiểm quyền ở
 * `(admin)/layout.tsx` trả "Không tìm thấy trang" kèm 200 — E2E bắt được, và công cụ giám sát hiểu sai.
 * Ở đây thì layout chạy TRƯỚC điểm stream, `notFound()` của nó ra 404 thật.
 */
export default function Loading() {
  return (
    <main className="container">
      <div className="card" style={{ textAlign: "center", padding: 48 }}>
        <div className="spinner" aria-hidden="true" />
        <p style={{ color: "var(--text-muted)", marginTop: 16 }}>Đang tải…</p>
        <span className="sr-only">Đang tải nội dung</span>
      </div>
    </main>
  );
}
