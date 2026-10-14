"use client";

import { useTransition } from "react";
import { deleteFileAction, renameFileAction } from "./actions";
import { Button } from "@/components/ui/button";

export function FileItemActions({
  id,
  name,
  attached,
}: {
  id: string;
  name: string;
  attached: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  const handleRename = () => {
    const next = window.prompt("Tên mới cho tệp:", name)?.trim();
    if (!next || next === name) return;
    startTransition(async () => {
      const res = await renameFileAction(id, next);
      if (res.error) window.alert(`Lỗi: ${res.error}`);
    });
  };

  const handleDelete = () => {
    if (!window.confirm(`Xoá vĩnh viễn tệp "${name}"? Không khôi phục được.`)) return;
    startTransition(async () => {
      const res = await deleteFileAction(id);
      if (res.error) window.alert(`Lỗi: ${res.error}`);
    });
  };

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleRename}>
        Đổi tên
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={isPending || attached}
        title={attached ? "Tệp đang được dùng — gỡ ra trước rồi mới xoá" : undefined}
        onClick={handleDelete}
      >
        {isPending ? "Đang xử lý..." : "Xoá"}
      </Button>
    </div>
  );
}
