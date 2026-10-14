import { Logo } from "@/components/layout/logo";

export function Footer() {
  return (
    <footer className="mt-20 border-t border-line/60">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-8 sm:flex-row sm:px-6 lg:px-8">
        <Logo size="sm" />
        <p className="text-xs text-muted">
          &copy; {new Date().getFullYear()} Xem Phim · Kho phim cá nhân
        </p>
      </div>
    </footer>
  );
}
