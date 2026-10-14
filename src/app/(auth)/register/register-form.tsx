"use client";

import { useActionState } from "react";
import { registerAction, type AuthFormState } from "../actions";
import { AuthFields, FORM_STYLE, type Field } from "../auth-form";

const initialState: AuthFormState = {};

const FIELDS: Field[] = [
  {
    name: "fullName",
    label: "Tên hiển thị",
    placeholder: "Nguyễn Văn A",
    autoComplete: "name",
  },
  {
    name: "email",
    label: "Email",
    type: "email",
    placeholder: "you@example.com",
    required: true,
    autoComplete: "email",
  },
  {
    name: "password",
    label: "Mật khẩu",
    type: "password",
    placeholder: "Tối thiểu 8 ký tự",
    required: true,
    autoComplete: "new-password",
  },
];

export function RegisterForm() {
  const [state, formAction, isPending] = useActionState(registerAction, initialState);

  return (
    <form action={formAction} style={FORM_STYLE}>
      <AuthFields
        fields={FIELDS}
        state={state}
        isPending={isPending}
        submitLabel="Đăng ký"
        pendingLabel="Đang tạo tài khoản…"
      />
    </form>
  );
}
