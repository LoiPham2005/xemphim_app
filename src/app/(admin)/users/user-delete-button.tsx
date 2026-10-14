"use client";

import { useTransition } from "react";
import { deleteUserAction } from "./actions";
import { Button } from "@/components/ui/button";

export function UserDeleteButton({ id, email }: { id: string; email: string }) {
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    if (
      typeof window !== "undefined" &&
      window.confirm(`Bạn có chắc chắn muốn xoá người dùng ${email}?`)
    ) {
      startTransition(async () => {
        const res = await deleteUserAction(id);
        if (res.error) {
          window.alert(`Lỗi: ${res.error}`);
        }
      });
    }
  };

  return (
    <Button
      type="button"
      onClick={handleDelete}
      disabled={isPending}
      variant="destructive"
      size="sm"
    >
      {isPending ? "Đang xoá..." : "Xoá"}
    </Button>
  );
}
