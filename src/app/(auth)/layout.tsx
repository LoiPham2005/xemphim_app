/** Nền "rạp chiếu" chung cho mọi trang đăng nhập/đăng ký/khôi phục — từng trang vẫn tự dựng form. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="cinema-backdrop -mt-16 min-h-[calc(100vh-4rem)] pt-16">{children}</div>;
}
