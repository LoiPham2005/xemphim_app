import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="container">
      <div className="card" style={{ textAlign: "center", padding: 48 }}>
        <div className="badge badge-primary" style={{ marginBottom: 16 }}>
          404
        </div>
        <h1 style={{ fontSize: "1.6rem", fontWeight: 700, marginBottom: 8 }}>
          Không tìm thấy trang
        </h1>
        <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>
          Đường dẫn không tồn tại, hoặc bạn không có quyền truy cập.
        </p>
        <Button asChild>
          <Link href="/">Về trang chủ</Link>
        </Button>
      </div>
    </main>
  );
}
