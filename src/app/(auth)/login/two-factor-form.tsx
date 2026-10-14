"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AuthFormState } from "../actions";
import { FORM_STYLE } from "../auth-form";

const initialState: AuthFormState = {};

/**
 * Bước 2 của đăng nhập: nhập mã từ app xác thực.
 *
 * MỘT ô nhập cho cả mã TOTP 6 số lẫn mã khôi phục 10 ký tự — người dùng ở màn
 * hình này không nên phải tự phân loại thứ mình đang dán vào. `TwoFactorService`
 * phân biệt bằng độ dài sau khi chuẩn hoá.
 */
export function TwoFactorForm({
  challengeToken,
  nextPath,
  action,
}: {
  challengeToken: string;
  nextPath?: string;
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} style={FORM_STYLE}>
      <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
        Mở ứng dụng xác thực và nhập mã 6 số. Mất thiết bị thì dùng một trong các{" "}
        <strong>mã khôi phục</strong> đã lưu.
      </p>

      {/* Vé đi kèm request, không nằm trong cookie: nó chỉ dùng đúng một lần
          cho đúng một bước, và không nên sống lâu hơn form này. */}
      <input type="hidden" name="twoFactorToken" value={state.twoFactorToken ?? challengeToken} />
      {nextPath && <input type="hidden" name="next" value={nextPath} />}

      <label>
        <span>Mã xác thực</span>
        <Input
          name="code"
          required
          autoFocus
          // `one-time-code` để iOS/Android tự điền mã từ thông báo.
          autoComplete="one-time-code"
          inputMode="text"
          placeholder="123456"
          aria-invalid={state.error ? true : undefined}
        />
      </label>

      {state.error && (
        <p role="alert" className="alert alert-danger">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Đang xác minh…" : "Xác minh"}
      </Button>
    </form>
  );
}
