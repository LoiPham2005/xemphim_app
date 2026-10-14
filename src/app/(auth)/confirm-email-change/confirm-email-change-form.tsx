"use client";

import { useActionState } from "react";
import Link from "next/link";
import { confirmEmailChangeAction, type AuthFormState } from "../actions";
import { FORM_STYLE } from "../auth-form";
import { Button } from "@/components/ui/button";

const initialState: AuthFormState = {};

export function ConfirmEmailChangeForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(confirmEmailChangeAction, initialState);

  if (state.success) {
    return (
      <>
        <div className="alert alert-success" role="status">
          {state.success}
        </div>
        <p style={{ marginTop: 20, fontSize: "0.9rem", color: "var(--text-muted)" }}>
          <Link href="/login">Đăng nhập</Link>
        </p>
      </>
    );
  }

  return (
    <form action={formAction} style={FORM_STYLE}>
      <input type="hidden" name="token" value={token} />

      {state.error && (
        <div className="alert alert-danger" role="alert">
          {state.error}
        </div>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Đang xác nhận…" : "Xác nhận đổi email"}
      </Button>
    </form>
  );
}
