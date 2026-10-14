import * as React from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Thông báo lỗi. Truyền vào là ô tự đổi màu và tự nối trợ năng. */
  error?: string;
  /** Chú thích dưới ô. Bị lỗi che khi có `error` — không hiện cả hai cùng lúc. */
  hint?: string;
}

/**
 * Ô nhập, kèm luôn phần hiển thị lỗi.
 *
 * ---
 * VÌ SAO LỖI DO CHÍNH Ô NHẬP RENDER
 *
 * Trước đây mỗi form tự viết `<input className="input-field" />` rồi tự thêm
 * một thẻ `<p>` màu đỏ bên dưới. Ba form, ba bản chép tay — và chỉ có form
 * đăng nhập nhớ nối `aria-invalid` với `aria-describedby`. Hai form còn lại
 * hiện lỗi mà trình đọc màn hình không đọc ra: người khiếm thị nghe thấy ô
 * trống, không biết vì sao gửi không được.
 *
 * Gói cả hai vào một chỗ thì việc nối trợ năng không còn là thứ phải nhớ.
 *
 * ⚠️ Cần truyền `id` để nối được `aria-describedby`. Không có `id` thì ô vẫn
 * chạy và vẫn hiện lỗi, chỉ là mất phần trợ năng.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, hint, id, ...props }, ref) => {
    const errorId = id ? `${id}-error` : undefined;
    const hintId = id ? `${id}-hint` : undefined;

    return (
      <div className="w-full">
        <input
          id={id}
          type={type}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={cn(
            "flex h-10 w-full rounded-token-md border border-line bg-canvas/60 px-3 py-2 text-sm text-content transition-colors placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-danger focus:border-danger focus:ring-danger/25",
            className,
          )}
          {...props}
        />

        {error ? (
          <p id={errorId} className="mt-1 text-xs text-danger">
            {error}
          </p>
        ) : (
          hint && (
            <p id={hintId} className="mt-1 text-xs text-muted">
              {hint}
            </p>
          )
        )}
      </div>
    );
  },
);
Input.displayName = "Input";

export { Input };
