"use client";

import { useActionState } from "react";
import { forgotPasswordAction, type AuthFormState } from "../actions";
import { AuthFields, FORM_STYLE, type Field } from "../auth-form";

const initialState: AuthFormState = {};

const FIELDS: Field[] = [
  {
    name: "email",
    label: "Email",
    type: "email",
    placeholder: "you@example.com",
    required: true,
    autoComplete: "email",
  },
];

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(forgotPasswordAction, initialState);

  // Gửi xong thì thay hẳn form bằng thông điệp, không để lại nút bấm.
  // Người dùng không nhận được thư sẽ bấm lại liên tục, mà mỗi lần bấm là một
  // token mới làm token cũ hết hiệu lực — họ tự vô hiệu hoá đúng cái link vừa
  // tới nơi.
  if (state.success) {
    return (
      <div className="alert alert-success" role="status">
        {state.success}
      </div>
    );
  }

  return (
    <form action={formAction} style={FORM_STYLE}>
      <AuthFields
        fields={FIELDS}
        state={state}
        isPending={isPending}
        submitLabel="Gửi hướng dẫn đặt lại"
        pendingLabel="Đang gửi…"
      />
    </form>
  );
}
