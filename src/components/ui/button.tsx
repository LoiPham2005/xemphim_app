import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/*
 * Màu lấy từ token của dự án (`brand`, `surface`, `line`…) chứ không phải thang
 * `gray-*`/`blue-*` của Tailwind.
 *
 * Bản trước dùng cặp nền-sáng kèm biến thể `dark:`, mà nhánh `dark:` không bao
 * giờ bật vì `<html>` không mang class `dark`. Kết quả là mọi nút phụ đều hiện
 * tông sáng trên nền tối. Dùng token thì không còn nhánh nào để quên bật.
 *
 * (Cố ý KHÔNG viết tên class cũ ra đây: bộ quét của Tailwind đọc cả comment,
 * nên một tên class nằm trong chú thích cũng đủ để sinh ra CSS thừa.)
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-token-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none",
  {
    variants: {
      variant: {
        default: "bg-brand text-white shadow-sm hover:bg-brand-hover",
        destructive: "bg-danger text-white shadow-sm hover:brightness-110",
        outline: "border border-line bg-transparent text-content hover:bg-elevated",
        secondary: "bg-elevated text-content hover:bg-line",
        ghost: "text-muted hover:bg-elevated hover:text-content",
        link: "text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-md px-8 text-base",
        icon: "h-10 w-10 p-0",
        "icon-sm": "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
