"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { captureException } from "@/lib/observability";

/**
 * Error boundary cho toàn bộ route tree. Không có file này, một exception chưa
 * bắt trong Server Component sẽ trả về trang lỗi trắng mặc định của Next.js.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // `digest` là mã Next.js gán cho lỗi phía server, dùng để tra lại đúng
    // stack trace trong log — thông điệp gốc bị ẩn khỏi client trên
    // production, cố ý như vậy.
    //
    // Không dùng `logger` ở đây: file này chạy trên TRÌNH DUYỆT, còn logger là
    // module server-side. `captureException` thì chạy được cả hai phía —
    // chưa cắm nhà cung cấp thì nó là hàm rỗng (xem src/lib/observability.ts).
    captureException(error, { digest: error.digest, boundary: "route" });
  }, [error]);

  return (
    <main className="container">
      <div className="card" style={{ textAlign: "center", padding: 48 }}>
        <div className="badge badge-danger" style={{ marginBottom: 16 }}>
          Lỗi hệ thống
        </div>
        <h1 style={{ fontSize: "1.6rem", fontWeight: 700, marginBottom: 8 }}>Đã có sự cố xảy ra</h1>
        <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>
          Yêu cầu của bạn không thể hoàn tất. Vui lòng thử lại.
        </p>

        {error.digest && (
          <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginBottom: 24 }}>
            Mã lỗi: <code>{error.digest}</code>
          </p>
        )}

        <Button type="button" onClick={reset}>
          Thử lại
        </Button>
      </div>
    </main>
  );
}
