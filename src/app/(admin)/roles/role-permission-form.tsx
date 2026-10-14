"use client";

import { useActionState } from "react";
import { updateRolePermissionsAction, type RoleFormState } from "./actions";
import type { Permission } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

const initialState: RoleFormState = {};

export type PermissionOption = { key: Permission; description: string };

export function RolePermissionForm({
  roleKey,
  granted,
  options,
  disabled,
}: {
  roleKey: string;
  granted: readonly Permission[];
  options: readonly PermissionOption[];
  /** true khi người đang xem không có quyền `role:update` — chỉ được nhìn. */
  disabled: boolean;
}) {
  const [state, formAction, isPending] = useActionState(updateRolePermissionsAction, initialState);
  const grantedSet = new Set(granted);

  return (
    <form action={formAction}>
      <input type="hidden" name="key" value={roleKey} />

      <div className="permission-grid">
        {options.map((option) => (
          <label key={option.key} className="permission-item">
            <input
              type="checkbox"
              name="permissions"
              value={option.key}
              defaultChecked={grantedSet.has(option.key)}
              disabled={disabled || isPending}
            />
            <span>
              <code>{option.key}</code>
              <span style={{ display: "block", color: "var(--text-muted)", fontSize: "0.8rem" }}>
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </div>

      {state.error && (
        <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}>
          {state.error}
        </div>
      )}

      {state.success && (
        <div className="alert alert-success" role="status" style={{ marginTop: 12 }}>
          {state.success}
        </div>
      )}

      {!disabled && (
        <Button type="submit" disabled={isPending} size="sm" className="mt-3">
          {isPending ? "Đang lưu…" : "Lưu phân quyền"}
        </Button>
      )}
    </form>
  );
}
