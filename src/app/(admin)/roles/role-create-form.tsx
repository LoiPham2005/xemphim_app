"use client";

import { useActionState, useEffect, useRef } from "react";
import { createRoleAction, type RoleFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initialState: RoleFormState = {};

export function RoleCreateForm() {
  const [state, formAction, isPending] = useActionState(createRoleAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div className="form-grid">
        <Input
          id="new-role-key"
          name="key"
          placeholder="KHOA_VAI_TRO (ví dụ: KE_TOAN)"
          required
          error={state.fieldErrors?.key?.[0]}
          hint="Không đổi được sau khi tạo — khoá này nằm trong các phiên đăng nhập đang chạy."
        />

        <Input
          id="new-role-name"
          name="name"
          placeholder="Tên hiển thị (ví dụ: Kế toán)"
          required
          error={state.fieldErrors?.name?.[0]}
        />

        <Input
          id="new-role-description"
          name="description"
          placeholder="Mô tả (không bắt buộc)"
          error={state.fieldErrors?.description?.[0]}
        />
      </div>

      <div className="form-actions">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Đang tạo…" : "+ Tạo vai trò"}
        </Button>
      </div>

      {state.error && (
        <div className="alert alert-danger" role="alert">
          {state.error}
        </div>
      )}

      {state.success && (
        <div className="alert alert-success" role="status">
          {state.success}
        </div>
      )}
    </form>
  );
}
