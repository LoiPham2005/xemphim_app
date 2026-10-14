"use client";

import { useActionState, useRef, useEffect } from "react";
import { createUserAction, type CreateUserState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initialState: CreateUserState = {};

export function UserForm() {
  const [state, formAction, isPending] = useActionState(createUserAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!isPending && !state.error && !state.fieldErrors) {
      formRef.current?.reset();
    }
  }, [isPending, state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <div className="form-grid">
        <Input
          id="new-user-email"
          name="email"
          type="email"
          placeholder="Email (ví dụ: user@example.com)"
          required
          error={state.fieldErrors?.email?.[0]}
        />

        <Input
          id="new-user-fullname"
          name="fullName"
          placeholder="Họ và tên (không bắt buộc)"
          error={state.fieldErrors?.fullName?.[0]}
        />

        <Input
          id="new-user-username"
          name="username"
          placeholder="Tên đăng nhập (không bắt buộc)"
          error={state.fieldErrors?.username?.[0]}
        />
      </div>

      <div className="form-actions">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Đang thêm..." : "+ Thêm người dùng"}
        </Button>
      </div>

      {state.error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "var(--radius-md)",
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "var(--danger-color)",
            fontSize: "0.9rem",
          }}
        >
          ⚠️ {state.error}
        </div>
      )}
    </form>
  );
}
