import type { AuthFieldName, AuthFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type Field = {
  /**
   * Dùng chung union với `AuthFormState.fieldErrors`. Nhờ vậy một ô không tồn
   * tại trong schema sẽ bị TypeScript chặn ngay tại đây, thay vì lặng lẽ gửi
   * lên rồi bị Zod strip mất — đúng lỗi đã làm hỏng đăng nhập trước đây.
   */
  name: AuthFieldName;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  /** Chú thích dưới ô, cho những trường tuỳ chọn cần giải thích thêm. */
  hint?: string;
};

/**
 * Phần hiển thị dùng chung của form đăng nhập/đăng ký.
 *
 * Cố ý KHÔNG nhận Server Action qua prop: khi action đi xuyên qua ranh giới
 * prop, React không nhúng được `$ACTION_ID` vào HTML và form ngừng hoạt động
 * nếu trình duyệt chưa tải xong JS. Vì vậy mỗi form (login-form/register-form)
 * tự import action của nó, còn file này chỉ lo phần nhìn.
 */
export function AuthFields({
  fields,
  state,
  isPending,
  submitLabel,
  pendingLabel,
  nextPath,
}: {
  fields: Field[];
  state: AuthFormState;
  isPending: boolean;
  submitLabel: string;
  pendingLabel: string;
  nextPath?: string;
}) {
  return (
    <>
      {nextPath && <input type="hidden" name="next" value={nextPath} />}

      {fields.map((field) => (
        <div key={field.name}>
          <label htmlFor={field.name} className="mb-1.5 block text-sm font-semibold text-content">
            {field.label}
          </label>

          {/* `Input` tự lo aria-invalid và aria-describedby — xem ghi chú trong
              component. Trước đây phần nối trợ năng đó phải chép tay ở từng
              form, và hai trong ba form đã quên. */}
          <Input
            id={field.name}
            name={field.name}
            type={field.type ?? "text"}
            placeholder={field.placeholder}
            required={field.required}
            autoComplete={field.autoComplete}
            error={state.fieldErrors?.[field.name]?.[0]}
            hint={field.hint}
          />
        </div>
      ))}

      {state.error && (
        <div className="alert alert-danger" role="alert">
          {state.error}
        </div>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? pendingLabel : submitLabel}
      </Button>
    </>
  );
}

export const FORM_STYLE = { display: "flex", flexDirection: "column", gap: 16 } as const;
