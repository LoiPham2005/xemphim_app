import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { cn } from "@/lib/cn";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  title?: string;
  href?: string;
}

export function Logo({
  className,
  size = "md",
  showText = true,
  title = "Xem Phim",
  href = "/",
}: LogoProps) {
  const sizes = {
    sm: { icon: "h-4 w-4", box: "p-1.5 rounded-lg", text: "text-base font-bold" },
    md: { icon: "h-5 w-5", box: "p-2 rounded-xl", text: "text-lg font-bold" },
    lg: { icon: "h-6 w-6", box: "p-2.5 rounded-xl", text: "text-xl font-extrabold" },
  };

  return (
    <Link href={href} className={cn("flex items-center gap-2.5 group select-none", className)}>
      <div
        className={cn(
          "flex items-center justify-center bg-brand text-white shadow-md shadow-brand/20 transition-transform group-hover:scale-105",
          sizes[size].box,
        )}
      >
        <Clapperboard className={sizes[size].icon} />
      </div>
      {showText && (
        <span className={cn("tracking-tight text-content", sizes[size].text)}>{title}</span>
      )}
    </Link>
  );
}
