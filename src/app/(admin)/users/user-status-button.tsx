"use client";

import { useTransition } from "react";
import { setUserStatusAction, unlockUserAction } from "./actions";
import type { UserStatus } from "@/schemas/user.schema";
import { Button } from "@/components/ui/button";

export function UserStatusButton({
  id,
  email,
  status,
  lockedUntil,
}: {
  id: string;
  email: string;
  status: UserStatus;
  /** ISO string nếu đang bị khoá tạm do sai mật khẩu liên tiếp — xem `AuthService`. */
  lockedUntil: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const isLockedNow = lockedUntil !== null && new Date(lockedUntil) > new Date();

  const toggleStatus = () => {
    const next: UserStatus = status === "BANNED" ? "ACTIVE" : "BANNED";
    const confirmMessage =
      next === "BANNED"
        ? `Khoá tài khoản ${email}? Người này sẽ không đăng nhập được nữa.`
        : `Mở khoá tài khoản ${email}?`;

    if (typeof window !== "undefined" && window.confirm(confirmMessage)) {
      startTransition(async () => {
        const res = await setUserStatusAction(id, { status: next });
        if (res.error) window.alert(`Lỗi: ${res.error}`);
      });
    }
  };

  const unlock = () => {
    startTransition(async () => {
      const res = await unlockUserAction(id);
      if (res.error) window.alert(`Lỗi: ${res.error}`);
    });
  };

  return (
    <div style={{ display: "flex", gap: 8 }}>
      {isLockedNow && (
        <Button
          type="button"
          onClick={unlock}
          disabled={isPending}
          variant="secondary"
          size="sm"
          title="Đăng nhập sai quá nhiều lần — mở khoá sớm thay vì đợi tự hết hạn"
        >
          Mở khoá tạm
        </Button>
      )}
      <Button
        type="button"
        onClick={toggleStatus}
        disabled={isPending}
        variant={status === "BANNED" ? "secondary" : "destructive"}
        size="sm"
      >
        {isPending ? "Đang xử lý..." : status === "BANNED" ? "Mở khoá" : "Khoá"}
      </Button>
    </div>
  );
}
