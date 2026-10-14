"use client";

import { useActionState } from "react";
import { loginAction, verifyTwoFactorAction, type AuthFormState } from "../actions";
import { AuthFields, FORM_STYLE, type Field } from "../auth-form";
import { TwoFactorForm } from "./two-factor-form";

const initialState: AuthFormState = {};

const FIELDS: Field[] = [
  {
    name: "identifier",
    label: "Email hoặc tên đăng nhập",
    placeholder: "you@example.com",
    required: true,
    autoComplete: "username",
  },
  {
    name: "password",
    label: "Mật khẩu",
    type: "password",
    placeholder: "••••••••",
    required: true,
    autoComplete: "current-password",
  },
];

export function LoginForm({ nextPath }: { nextPath?: string }) {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);

  /*
   * Hai form RIÊNG BIỆT, không phải một form đổi trường.
   *
   * `useActionState` gắn liền với MỘT action. Nhét cả hai bước vào một form
   * buộc action đăng nhập phải tự đoán mình đang ở bước nào theo dữ liệu gửi
   * lên — và đoán sai một lần là bỏ qua luôn lớp thứ hai.
   */
  if (state.twoFactorToken) {
    return (
      <TwoFactorForm
        challengeToken={state.twoFactorToken}
        nextPath={nextPath}
        action={verifyTwoFactorAction}
      />
    );
  }

  return (
    <form action={formAction} style={FORM_STYLE}>
      <AuthFields
        fields={FIELDS}
        state={state}
        isPending={isPending}
        submitLabel="Đăng nhập"
        pendingLabel="Đang đăng nhập…"
        nextPath={nextPath}
      />
    </form>
  );
}
