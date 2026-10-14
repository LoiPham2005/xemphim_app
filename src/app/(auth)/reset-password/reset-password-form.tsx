"use client";

import { useActionState } from "react";
import { resetPasswordAction, type AuthFormState } from "../actions";
import { AuthFields, FORM_STYLE, type Field } from "../auth-form";

const initialState: AuthFormState = {};

const FIELDS: Field[] = [
  {
    name: "password",
    label: "Mật khẩu mới",
    type: "password",
    placeholder: "Tối thiểu 8 ký tự",
    required: true,
    autoComplete: "new-password",
  },
];

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(resetPasswordAction, initialState);

  return (
    <form action={formAction} style={FORM_STYLE}>
      {/*
        Token đi kèm dưới dạng field ẩn thay vì đọc lại từ URL trong action:
        Server Action không thấy được URL của trang đã gọi nó. Đây cũng là lý
        do action phải tự validate lại token — field ẩn thì ai cũng sửa được.
      */}
      <input type="hidden" name="token" value={token} />

      <AuthFields
        fields={FIELDS}
        state={state}
        isPending={isPending}
        submitLabel="Đặt mật khẩu mới"
        pendingLabel="Đang lưu…"
      />
    </form>
  );
}
